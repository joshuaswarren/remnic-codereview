// CLI production entry point — wires createProgram to real I/O.
// Built as dist/cli.js with a shebang for direct execution.

import { readFileSync } from "node:fs";
import { runInit } from "./cli/init.js";
import { runLessonsList, runLessonsShow } from "./cli/lessons.js";
import { createProgram, type ParsedCommand } from "./cli.js";
import { ingestRules } from "./ingest/rules.js";
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
	const opts: {
		memoryDir: string;
		json: boolean;
		filter?: Record<string, string>;
		sort?: string;
		limit?: number;
		cursor?: string;
	} = {
		memoryDir: expandTilde(memoryDir),
		json: cmd.json ?? false,
	};
	if (cmd.filter) opts.filter = cmd.filter;
	if (cmd.sort) opts.sort = cmd.sort;
	if (cmd.limit) opts.limit = cmd.limit;
	if (cmd.cursor) opts.cursor = cmd.cursor;
	await runLessonsList(opts);
}

/** Execute the lessons show command (async). */
async function executeLessonsShow(
	cmd: Extract<ParsedCommand, { command: "lessons-show" }>,
): Promise<void> {
	const memoryDir = cmd.memoryDir ?? `~/.remnic-codereview/local__rules`;
	await runLessonsShow({
		memoryDir: expandTilde(memoryDir),
		lessonId: cmd.lessonId,
		json: cmd.json ?? false,
	});
}

const program = createProgram({
	getVersion,
	execute: executeCommand,
});

program.parse();
