// CLI production entry point — wires createProgram to real I/O.
// Built as dist/cli.js with a shebang for direct execution.

import { readFileSync } from "node:fs";
import { runInit } from "./cli/init.js";
import { createProgram, type ParsedCommand } from "./cli.js";
import { ingestRules } from "./ingest/rules.js";
import { MemoryAdapter } from "./memory/adapter.js";
import { expandTilde } from "./utils/expand-tilde.js";

function getVersion(): string {
	try {
		const url = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(url, "utf-8")) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function executeCommand(cmd: ParsedCommand): void {
	switch (cmd.command) {
		case "init":
			try {
				runInit({
					owner: cmd.owner,
					repo: cmd.repo,
					memoryDir: cmd.memoryDir ?? `~/.remnic-codereview/${cmd.owner}__${cmd.repo}`,
					force: cmd.force,
					quality: cmd.quality,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Error: ${message}\n`);
				process.exit(1);
			}
			break;

		case "ingest":
			executeIngest(cmd).catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Error: ${message}\n`);
				process.exit(1);
			});
			break;

		case "lessons-list":
			executeLessonsList(cmd).catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Error: ${message}\n`);
				process.exit(1);
			});
			break;

		case "lessons-show":
			executeLessonsShow(cmd).catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Error: ${message}\n`);
				process.exit(1);
			});
			break;

		default:
			process.stderr.write(`Subcommand "${cmd.command}" is not yet implemented.\n`);
			process.exit(1);
	}
}

/** Execute the ingest command (async). */
async function executeIngest(cmd: Extract<ParsedCommand, { command: "ingest" }>): Promise<void> {
	const memoryDir = cmd.memoryDir ?? `~/.remnic-codereview/local__rules`;

	if (cmd.rulesPath) {
		const result = await ingestRules({
			rulesPath: cmd.rulesPath,
			memoryDir: expandTilde(memoryDir),
			quality: cmd.quality,
			dryRun: cmd.dryRun,
		});
		process.stdout.write(`${result.stdout}\n`);
		return;
	}

	if (cmd.prReviews) {
		process.stderr.write("Error: --pr-reviews is not yet implemented.\n");
		process.exit(1);
	}

	if (cmd.history) {
		process.stderr.write("Error: --history is not yet implemented.\n");
		process.exit(1);
	}

	if (cmd.all) {
		process.stderr.write("Error: --all is not yet implemented.\n");
		process.exit(1);
	}

	process.stderr.write(
		"Error: No ingest source specified. Use --rules <path>, --pr-reviews <slug>, --history <slug>, or --all <slug>.\n",
	);
	process.exit(1);
}

/** Execute the lessons list command (async). */
async function executeLessonsList(
	cmd: Extract<ParsedCommand, { command: "lessons-list" }>,
): Promise<void> {
	const memoryDir = cmd.memoryDir ?? `~/.remnic-codereview/local__rules`;
	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: expandTilde(memoryDir),
		owner: "local",
		repo: "rules",
	});

	try {
		const filter: {
			severity?: string;
			source_kind?: string;
			tags?: string[];
			limit?: number;
			cursor?: string;
		} = {};
		if (cmd.filter) {
			if (cmd.filter.severity) filter.severity = cmd.filter.severity;
			if (cmd.filter.source_kind) filter.source_kind = cmd.filter.source_kind;
			if (cmd.filter.tags) filter.tags = cmd.filter.tags.split(",");
		}
		if (cmd.limit) filter.limit = cmd.limit;
		if (cmd.cursor) filter.cursor = cmd.cursor;

		const { items, cursor } = await adapter.listLessons(filter);

		if (cmd.json) {
			process.stdout.write(`${JSON.stringify({ items, total: items.length, cursor }, null, 2)}\n`);
		} else if (items.length === 0) {
			process.stdout.write("No lessons found.\n");
		} else {
			// Render table
			process.stdout.write("ID                                 SEVERITY   SUMMARY\n");
			process.stdout.write(
				"────────────────────────────────── ────────── ────────────────────────────────────────\n",
			);
			for (const lesson of items) {
				const id = lesson.id.padEnd(34);
				const severity = lesson.severity.padEnd(10);
				const summary = lesson.summary.slice(0, 50);
				process.stdout.write(`${id} ${severity} ${summary}\n`);
			}
			process.stdout.write(`\nTotal: ${items.length} lessons\n`);
		}
	} finally {
		await adapter.shutdown();
	}
}

/** Execute the lessons show command (async). */
async function executeLessonsShow(
	cmd: Extract<ParsedCommand, { command: "lessons-show" }>,
): Promise<void> {
	const memoryDir = cmd.memoryDir ?? `~/.remnic-codereview/local__rules`;
	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: expandTilde(memoryDir),
		owner: "local",
		repo: "rules",
	});

	try {
		const lesson = await adapter.getLesson(cmd.lessonId);
		if (!lesson) {
			process.stderr.write(`Lesson ${cmd.lessonId} not found.\n`);
			process.exit(1);
		}

		if (cmd.json) {
			process.stdout.write(`${JSON.stringify(lesson, null, 2)}\n`);
		} else {
			process.stdout.write(`ID:          ${lesson.id}\n`);
			process.stdout.write(`Summary:     ${lesson.summary}\n`);
			process.stdout.write(`Severity:    ${lesson.severity}\n`);
			process.stdout.write(`Source Kind: ${lesson.source_kind}\n`);
			process.stdout.write(`Source URL:  ${lesson.source_url}\n`);
			process.stdout.write(`Date:        ${lesson.original_incident_date}\n`);
			process.stdout.write(`Still Applies: ${lesson.still_applies}\n`);
			process.stdout.write(`Tags:        ${lesson.tags.join(", ")}\n`);
			if (lesson.pattern_keywords) {
				process.stdout.write(`Keywords:    ${lesson.pattern_keywords.join(", ")}\n`);
			}
			if (lesson.what_to_check) {
				process.stdout.write(`What to Check: ${lesson.what_to_check}\n`);
			}
			if (lesson.suggested_fix_template) {
				process.stdout.write(`Suggested Fix: ${lesson.suggested_fix_template}\n`);
			}
		}
	} finally {
		await adapter.shutdown();
	}
}

const program = createProgram({
	getVersion,
	execute: executeCommand,
});

program.parse();
