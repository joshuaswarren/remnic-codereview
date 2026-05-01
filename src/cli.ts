// CLI entry point — Commander-based with subcommands stubbed.
// Subcommands: init, ingest, lessons, review, serve.
// Every subcommand rejects unknown flag values with non-zero exit + stderr.
// --help prints usage + exits 0. --version prints semver from package.json + exits 0.

import { Command, InvalidArgumentError, Option } from "commander";
import { expandTilde } from "./utils/expand-tilde.js";

// ─── Parsed result types ─────────────────────────────────────────────────────

export type QualityPreset = "default" | "high" | "cheap";

/** Valid severity values for filter validation. */
const VALID_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

/** Valid filter keys for lessons list. */
const VALID_FILTER_KEYS = ["severity", "source_kind", "tags", "still_applies"] as const;

/** Valid sort keys for lessons list. */
const VALID_SORT_KEYS = ["original_incident_date", "hit_count", "confidence"] as const;

export type ParsedCommand =
	| {
			command: "init";
			owner: string;
			repo: string;
			memoryDir: string | undefined;
			force: boolean;
			quality: QualityPreset;
	  }
	| {
			command: "ingest";
			rulesPath: string | undefined;
			prReviews: string | undefined;
			history: string | undefined;
			all: string | undefined;
			memoryDir: string | undefined;
			quality: QualityPreset;
			dryRun: boolean;
	  }
	| {
			command: "lessons-list";
			memoryDir: string | undefined;
			json: boolean | undefined;
			filter: Record<string, string> | undefined;
			sort: string | undefined;
			limit: number | undefined;
			cursor: string | undefined;
	  }
	| {
			command: "lessons-show";
			lessonId: string;
			memoryDir: string | undefined;
			json: boolean | undefined;
	  }
	| {
			command: "review";
			slug: string;
			prNumber: number;
			memoryDir: string | undefined;
			quality: QualityPreset;
			dryRun: boolean;
			target: string | undefined;
			threshold: number | undefined;
	  }
	| { command: "serve"; port: number; memoryDir: string | undefined; quality: QualityPreset };

// ─── DI callbacks for testing ────────────────────────────────────────────────

export interface CreateProgramOptions {
	getVersion: () => string;
	execute: (cmd: ParsedCommand) => void;
	writeOut?: (s: string) => void;
	writeErr?: (s: string) => void;
	exitOverride?: () => never;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

/** Parse and validate a --quality value. */
function parseQuality(value: string): QualityPreset {
	const valid: QualityPreset[] = ["default", "high", "cheap"];
	if (valid.includes(value as QualityPreset)) {
		return value as QualityPreset;
	}
	throw new InvalidArgumentError(
		`Invalid quality value: "${value}". Accepted values: ${valid.join(", ")}`,
	);
}

/** Parse a positive integer from a string. */
function parsePositiveInt(value: string): number {
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 0) {
		throw new InvalidArgumentError(`Expected a positive integer, got: "${value}"`);
	}
	return n;
}

/** Parse and validate a --filter key=value pair. */
function parseFilter(value: string): Record<string, string> {
	const eqIndex = value.indexOf("=");
	if (eqIndex === -1) {
		throw new InvalidArgumentError(`Invalid filter format: "${value}". Expected <key>=<value>`);
	}
	const key = value.slice(0, eqIndex);
	const val = value.slice(eqIndex + 1);

	if (!(VALID_FILTER_KEYS as readonly string[]).includes(key)) {
		throw new InvalidArgumentError(
			`Unknown filter key: "${key}". Valid keys: ${(VALID_FILTER_KEYS as readonly string[]).join(", ")}`,
		);
	}

	if (key === "severity" && !(VALID_SEVERITIES as readonly string[]).includes(val)) {
		throw new InvalidArgumentError(
			`Invalid severity value: "${val}". Accepted values: ${(VALID_SEVERITIES as readonly string[]).join(", ")}`,
		);
	}

	return { [key]: val };
}

/** Merge multiple filter results. */
function mergeFilters(filters: Record<string, string>[]): Record<string, string> | undefined {
	if (filters.length === 0) return undefined;
	return Object.assign({}, ...filters);
}

/** Parse and validate a --sort value. */
function parseSort(value: string): string {
	// Support optional :asc/:desc suffix
	const colonIdx = value.indexOf(":");
	const baseKey = colonIdx === -1 ? value : value.slice(0, colonIdx);
	const direction = colonIdx === -1 ? undefined : value.slice(colonIdx + 1);

	if (!(VALID_SORT_KEYS as readonly string[]).includes(baseKey)) {
		throw new InvalidArgumentError(
			`Invalid sort key: "${baseKey}". Valid keys: ${(VALID_SORT_KEYS as readonly string[]).join(", ")}`,
		);
	}

	if (direction !== undefined && direction !== "asc" && direction !== "desc") {
		throw new InvalidArgumentError(`Invalid sort direction: "${direction}". Use "asc" or "desc"`);
	}

	return value;
}

/** Parse and validate <owner/repo> slug. */
function parseSlug(value: string): string {
	if (!value.includes("/") || value.split("/").length !== 2) {
		throw new InvalidArgumentError(`Invalid slug: "${value}". Expected <owner>/<repo> format`);
	}
	return value;
}

/** Parse PR number — must be a positive integer. */
function parsePrNumber(value: string): number {
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n <= 0 || value !== String(n)) {
		throw new InvalidArgumentError(`Invalid PR number: "${value}". Must be a positive integer`);
	}
	return n;
}

// ─── Program builder ─────────────────────────────────────────────────────────

/**
 * Create the Commander program. Accepts dependency-injection options for testing.
 * In production, caller uses real stdout/stderr, real process.exit, real version.
 */
export function createProgram(opts: CreateProgramOptions): Command {
	const program = new Command();

	program
		.name("remnic-codereview")
		.description("Memory-augmented code review bot")
		.version(opts.getVersion(), "-V, --version", "Print version and exit")
		.helpOption("-h, --help", "Print usage and exit")
		.option("--memory-dir <path>", "Override the default memory directory")
		.addOption(
			new Option("--quality <preset>", "Quality preset for model selection")
				.choices(["default", "high", "cheap"])
				.default("default"),
		);

	// Configure output / exit
	if (opts.writeOut) program.configureOutput({ writeOut: opts.writeOut });
	if (opts.writeErr) program.configureOutput({ writeErr: opts.writeErr });
	if (opts.exitOverride) program.exitOverride(opts.exitOverride);

	// Suggest --help when an unknown subcommand is given (VAL-M1-004)
	program.on("command:*", (operands) => {
		const name = operands[0] ?? "";
		program.error(`unknown command '${name}'. Run 'remnic-codereview --help' for usage.`, {
			exitCode: 1,
		});
	});

	// ─── init subcommand ──────────────────────────────────────────────────

	program
		.command("init")
		.description("Create per-repo memory directory and config snapshot")
		.requiredOption("--owner <owner>", "Repository owner")
		.requiredOption("--repo <repo>", "Repository name")
		.option("--force", "Overwrite existing config without prompting")
		.action((cmdOpts) => {
			const parentOpts = program.opts();
			opts.execute({
				command: "init",
				owner: cmdOpts.owner,
				repo: cmdOpts.repo,
				memoryDir: parentOpts.memoryDir ? expandTilde(parentOpts.memoryDir) : undefined,
				force: cmdOpts.force ?? false,
				quality: parseQuality(parentOpts.quality ?? "default"),
			});
		});

	// ─── ingest subcommand ────────────────────────────────────────────────

	program
		.command("ingest")
		.description("Ingest lessons from rules files, PR reviews, or history")
		.option("--rules <path>", "Ingest from a local rules directory")
		.option("--pr-reviews <slug>", "Ingest PR reviews from <owner>/<repo>")
		.option("--history <slug>", "Ingest history from <owner>/<repo>")
		.option("--all <slug>", "Ingest rules + pr-reviews + history from <owner>/<repo>")
		.option("--dry-run", "Print stats without writing to memory")
		.option("--memory-dir <path>", "Override the default memory directory")
		.addOption(
			new Option("--quality <preset>", "Quality preset for model selection")
				.choices(["default", "high", "cheap"])
				.default("default"),
		)
		.action((cmdOpts) => {
			const parentOpts = program.opts();
			// If the subcommand quality was explicitly set to something other than
			// the default, prefer it. Otherwise use the parent/global quality.
			const subQuality = cmdOpts.quality as string | undefined;
			const parentQuality = parentOpts.quality as string | undefined;
			const quality = parseQuality(
				subQuality && subQuality !== "default" ? subQuality : (parentQuality ?? "default"),
			);
			const memoryDir = cmdOpts.memoryDir
				? expandTilde(cmdOpts.memoryDir)
				: parentOpts.memoryDir
					? expandTilde(parentOpts.memoryDir)
					: undefined;

			opts.execute({
				command: "ingest",
				rulesPath: cmdOpts.rules,
				prReviews: cmdOpts.prReviews,
				history: cmdOpts.history,
				all: cmdOpts.all,
				memoryDir,
				quality,
				dryRun: cmdOpts.dryRun ?? false,
			});
		});

	// ─── lessons subcommand ───────────────────────────────────────────────

	const lessonsCmd = program.command("lessons").description("Browse stored lessons");

	// lessons list
	lessonsCmd
		.command("list")
		.description("List stored lessons with optional filtering and pagination")
		.option("--json", "Output as JSON instead of a table")
		.option(
			"--filter <key=value>",
			"Filter lessons (repeatable). Keys: severity, source_kind, tags, still_applies",
			(value: string, previous: Record<string, string>[]) => {
				const parsed = parseFilter(value);
				return [...(previous ?? []), parsed];
			},
			[] as Record<string, string>[],
		)
		.option("--sort <field>", "Sort lessons by field", parseSort)
		.option("--limit <n>", "Limit number of results", parsePositiveInt)
		.option("--cursor <cursor>", "Pagination cursor from a previous list call")
		.addOption(
			new Option("--memory-dir <path>", "Override the default memory directory").default(undefined),
		)
		.action((cmdOpts) => {
			const parentOpts = program.opts();
			const memoryDir = cmdOpts.memoryDir
				? expandTilde(cmdOpts.memoryDir)
				: parentOpts.memoryDir
					? expandTilde(parentOpts.memoryDir)
					: undefined;

			opts.execute({
				command: "lessons-list",
				memoryDir,
				json: cmdOpts.json ?? false,
				filter: mergeFilters(cmdOpts.filter),
				sort: cmdOpts.sort,
				limit: cmdOpts.limit,
				cursor: cmdOpts.cursor,
			});
		});

	// lessons show
	lessonsCmd
		.command("show")
		.description("Show detailed information for a single lesson")
		.argument("<id>", "Lesson ID to show")
		.option("--json", "Output as JSON")
		.addOption(
			new Option("--memory-dir <path>", "Override the default memory directory").default(undefined),
		)
		.action((id: string, cmdOpts) => {
			const parentOpts = program.opts();
			const memoryDir = cmdOpts.memoryDir
				? expandTilde(cmdOpts.memoryDir)
				: parentOpts.memoryDir
					? expandTilde(parentOpts.memoryDir)
					: undefined;

			opts.execute({
				command: "lessons-show",
				lessonId: id,
				memoryDir,
				json: cmdOpts.json ?? false,
			});
		});

	// ─── review subcommand ────────────────────────────────────────────────

	program
		.command("review")
		.description("Run the review pipeline on a pull request")
		.argument("<slug>", "Repository slug in <owner>/<repo> format", parseSlug)
		.argument("<pr-number>", "Pull request number", parsePrNumber)
		.option("--dry-run", "Print the review without posting")
		.option("--target <slug>", "Post the review to a different repository")
		.option("--threshold <n>", "Confidence threshold (0-1)", parseFloat)
		.option("--memory-dir <path>", "Override the default memory directory")
		.addOption(
			new Option("--quality <preset>", "Quality preset for model selection")
				.choices(["default", "high", "cheap"])
				.default("default"),
		)
		.action((slug: string, prNumber: number, cmdOpts) => {
			const parentOpts = program.opts();
			const subQuality = cmdOpts.quality as string | undefined;
			const parentQuality = parentOpts.quality as string | undefined;
			const quality = parseQuality(
				subQuality && subQuality !== "default" ? subQuality : (parentQuality ?? "default"),
			);
			const memoryDir = cmdOpts.memoryDir
				? expandTilde(cmdOpts.memoryDir)
				: parentOpts.memoryDir
					? expandTilde(parentOpts.memoryDir)
					: undefined;

			opts.execute({
				command: "review",
				slug,
				prNumber,
				memoryDir,
				quality,
				dryRun: cmdOpts.dryRun ?? false,
				target: cmdOpts.target,
				threshold: cmdOpts.threshold,
			});
		});

	// ─── serve subcommand ─────────────────────────────────────────────────

	program
		.command("serve")
		.description("Start the Express server and dashboard")
		.option("--port <n>", "Port to listen on", parsePositiveInt, 4317)
		.option("--memory-dir <path>", "Override the default memory directory")
		.action((cmdOpts) => {
			const parentOpts = program.opts();
			const memoryDir = cmdOpts.memoryDir
				? expandTilde(cmdOpts.memoryDir)
				: parentOpts.memoryDir
					? expandTilde(parentOpts.memoryDir)
					: undefined;

			opts.execute({
				command: "serve",
				port: cmdOpts.port,
				memoryDir,
				quality: parseQuality(parentOpts.quality ?? "default"),
			});
		});

	return program;
}
