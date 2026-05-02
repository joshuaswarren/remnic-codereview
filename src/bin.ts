// CLI production entry point — wires createProgram to real I/O.
// Built as dist/cli.js with a shebang for direct execution.

import { readFileSync } from "node:fs";
import { runInit } from "./cli/init.js";
import { runLessonsList, runLessonsShow } from "./cli/lessons.js";
import { createProgram, type ParsedCommand } from "./cli.js";
import { getGitHubClient } from "./github/client.js";
import { ingestHistory } from "./ingest/history.js";
import { ingestPrReviews } from "./ingest/pr-reviews.js";
import { ingestRules } from "./ingest/rules.js";
import { runReview } from "./review/run-review.js";
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

		case "review":
			executeReview(cmd).catch((err: unknown) => {
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
			rulesPath: expandTilde(cmd.rulesPath),
			memoryDir: expandTilde(memoryDir),
			quality: cmd.quality,
			dryRun: cmd.dryRun,
		});
		process.stdout.write(`${result.stdout}\n`);
		return;
	}

	if (cmd.prReviews) {
		const slugParts = cmd.prReviews.split("/");
		if (slugParts.length !== 2 || !slugParts[0] || !slugParts[1]) {
			process.stderr.write(
				`Error: Invalid slug: "${cmd.prReviews}". Expected <owner>/<repo> format.\n`,
			);
			process.exit(1);
		}
		const [owner, repo] = slugParts;
		const includeBots = cmd.includeBots ?? false;
		let since: Date | undefined;
		if (cmd.since) {
			since = new Date(cmd.since);
			if (Number.isNaN(since.getTime())) {
				process.stderr.write(
					`Error: Invalid --since value: "${cmd.since}". Expected ISO 8601 date (e.g. 2026-01-01).\n`,
				);
				process.exit(1);
			}
		}
		if (cmd.maxPrs !== undefined && cmd.maxPrs <= 0) {
			process.stderr.write(`Error: --max-prs must be a positive integer, got: ${cmd.maxPrs}.\n`);
			process.exit(1);
		}
		const result = await ingestPrReviews({
			owner,
			repo,
			memoryDir: expandTilde(memoryDir),
			quality: cmd.quality,
			dryRun: cmd.dryRun,
			includeBots,
			since,
			maxPrs: cmd.maxPrs,
		});
		process.stdout.write(`${result.stdout}\n`);
		return;
	}

	if (cmd.history) {
		const slugParts = cmd.history.split("/");
		if (slugParts.length !== 2 || !slugParts[0] || !slugParts[1]) {
			process.stderr.write(
				`Error: Invalid slug: "${cmd.history}". Expected <owner>/<repo> format.\n`,
			);
			process.exit(1);
		}
		const [owner, repo] = slugParts;
		const memoryDirResolved = expandTilde(memoryDir);
		const result = await ingestHistory({
			owner,
			repo,
			repoPath: process.cwd(),
			memoryDir: memoryDirResolved,
			quality: cmd.quality,
			dryRun: cmd.dryRun,
			since: cmd.since ? new Date(cmd.since) : undefined,
			max: cmd.max,
		});
		process.stdout.write(`${result.stdout}\n`);
		return;
	}

	if (cmd.all) {
		const slugParts = cmd.all.split("/");
		if (slugParts.length !== 2 || !slugParts[0] || !slugParts[1]) {
			process.stderr.write(`Error: Invalid slug: "${cmd.all}". Expected <owner>/<repo> format.\n`);
			process.exit(1);
		}
		const [owner, repo] = slugParts;
		const memoryDirResolved = expandTilde(memoryDir);
		const since = cmd.since ? new Date(cmd.since) : undefined;

		// 1. Rules ingestion (using current directory as rules source)
		process.stdout.write("=== Rules ingestion ===\n");
		try {
			const rulesResult = await ingestRules({
				rulesPath: process.cwd(),
				memoryDir: memoryDirResolved,
				quality: cmd.quality,
				dryRun: cmd.dryRun,
			});
			process.stdout.write(`${rulesResult.stdout}\n`);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Rules ingestion skipped: ${message}\n`);
		}

		// 2. PR reviews
		process.stdout.write("=== PR reviews ingestion ===\n");
		const includeBots = cmd.includeBots ?? false;
		if (cmd.maxPrs !== undefined && cmd.maxPrs <= 0) {
			process.stderr.write(`Error: --max-prs must be a positive integer, got: ${cmd.maxPrs}.\n`);
			process.exit(1);
		}
		try {
			const prResult = await ingestPrReviews({
				owner,
				repo,
				memoryDir: memoryDirResolved,
				quality: cmd.quality,
				dryRun: cmd.dryRun,
				includeBots,
				since,
				maxPrs: cmd.maxPrs,
			});
			process.stdout.write(`${prResult.stdout}\n`);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`PR reviews ingestion error: ${message}\n`);
		}

		// 3. History
		process.stdout.write("=== History ingestion ===\n");
		try {
			const histResult = await ingestHistory({
				owner,
				repo,
				repoPath: process.cwd(),
				memoryDir: memoryDirResolved,
				quality: cmd.quality,
				dryRun: cmd.dryRun,
				since,
				max: cmd.max,
			});
			process.stdout.write(`${histResult.stdout}\n`);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`History ingestion error: ${message}\n`);
		}

		return;
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

/** Execute the review command (async). */
async function executeReview(cmd: Extract<ParsedCommand, { command: "review" }>): Promise<void> {
	// Check prerequisites before making any calls
	if (!process.env.OPENAI_API_KEY && process.env.OPENAI_JUDGE_STUB !== "1") {
		process.stderr.write(
			"Error: OPENAI_API_KEY is not set. Set it in your environment or secrets.env.\n",
		);
		process.exit(1);
	}
	if (!process.env.GITHUB_TOKEN && process.env.OPENAI_JUDGE_STUB !== "1") {
		process.stderr.write(
			"Error: GITHUB_TOKEN is not set. Set it in your environment or secrets.env.\n",
		);
		process.exit(1);
	}

	// Validate threshold if provided
	if (cmd.threshold !== undefined) {
		if (Number.isNaN(cmd.threshold) || cmd.threshold < 0 || cmd.threshold > 1) {
			process.stderr.write(
				`Error: --threshold must be a number in [0, 1], got: ${cmd.threshold}\n`,
			);
			process.exit(1);
		}
	}

	const [owner, repo] = cmd.slug.split("/");
	if (!owner || !repo) {
		process.stderr.write(`Error: Invalid slug: "${cmd.slug}". Expected <owner>/<repo> format.\n`);
		process.exit(1);
	}
	const memoryDir = cmd.memoryDir ?? `~/.remnic-codereview/${owner}__${repo}`;
	const client = await getGitHubClient();

	const result = await runReview(client, {
		owner,
		repo,
		prNumber: cmd.prNumber,
		memoryDir: expandTilde(memoryDir),
		quality: cmd.quality,
		dryRun: cmd.dryRun,
		target: cmd.target,
		threshold: cmd.threshold,
	});

	process.stdout.write(result.rendered);
	process.stdout.write("\n");

	if (result.hadBinaryHunks) {
		process.stderr.write("Note: binary diff detected — skipped.\n");
	}

	if (result.commentCount === 0 && result.hunkCount > 0) {
		process.stderr.write("Note: no relevant lessons found.\n");
	}
}

const program = createProgram({
	getVersion,
	execute: executeCommand,
});

program.parse();
