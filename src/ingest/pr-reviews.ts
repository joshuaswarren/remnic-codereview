// PR-review ingestion — the PRIMARY SOURCE for institutional memory.
// Ingests all four GitHub PR-review surfaces:
//   1. Overall reviews (pr_review_overall)
//   2. Inline comments (pr_review_inline)
//   3. Threaded replies (pr_review_reply)
//   4. Issue-style comments (pr_discussion)
// Each produces Lessons with full metadata per architecture.md.
// Bot filtering (--include-bots). Idempotent on comment_id dedup.
// Pagination via octokit.paginate. Resumable via per-PR cursor.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QualityPreset } from "../cli.js";
import { info } from "../log.js";
import { type AdapterConfig, MemoryAdapter } from "../memory/adapter.js";
import type { Config } from "../schemas/config.js";
import type { IngestSource } from "../schemas/ingest-source.js";
import type { Lesson } from "../schemas/lesson.js";
import { extractLessons } from "./extraction.js";

// ── Bot user names excluded by default ───────────────────────────────────────

const KNOWN_BOTS = new Set([
	"chatgpt-codex-connector[bot]",
	"cursor[bot]",
	"codeql",
	"dependabot[bot]",
	"github-actions[bot]",
]);

// ── Types ────────────────────────────────────────────────────────────────────

/** Options for the PR-review ingestion command. */
export interface IngestPrReviewsOptions {
	owner: string;
	repo: string;
	memoryDir: string;
	quality: QualityPreset;
	dryRun: boolean;
	includeBots: boolean;
	since: Date | undefined;
	maxPrs: number | undefined;
}

/** Per-source-kind stat counters. */
export interface IngestStats {
	pr_review_overall: number;
	pr_review_inline: number;
	pr_review_reply: number;
	pr_discussion: number;
	lessons_added: number;
	lessons_skipped_dedup: number;
	lessons_skipped_empty_body: number;
	lessons_skipped_bot: number;
	prs_scanned: number;
	prs_skipped_since: number;
}

/** Result of the PR-review ingestion. */
export interface IngestPrReviewsResult {
	exitCode: number;
	stats: IngestStats;
	stdout: string;
}

/** Per-PR cursor state for resumability. */
interface PRIngestCursor {
	last_pr_number: number;
	last_run_at: string;
}

/** GitHub client interface — subset needed for PR-review ingestion. */
export interface GitHubClientLike {
	listPRs(
		owner: string,
		repo: string,
		options?: {
			state?: "open" | "closed" | "all";
			sort?: "created" | "updated" | "popularity" | "long-running";
			direction?: "asc" | "desc";
		},
	): Promise<
		Array<{
			number: number;
			title: string;
			state: string;
			merged: boolean;
			merged_at: string | null;
			html_url: string;
			user: { login: string } | null;
			created_at: string;
			updated_at: string;
		}>
	>;
	listReviews(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<
		Array<{
			id: number;
			state: string;
			body: string;
			user: { login: string } | null;
			submitted_at: string;
			html_url: string;
		}>
	>;
	listReviewComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<
		Array<{
			id: number;
			path: string;
			original_line: number | null;
			line: number | null;
			original_start_line: number | null;
			start_line: number | null;
			diff_hunk: string;
			commit_id: string;
			position: number | null;
			original_position: number | null;
			side: string;
			start_side: string | null;
			pull_request_review_id: number | null;
			in_reply_to_id: number | null;
			user: { login: string } | null;
			created_at: string;
			updated_at: string;
			html_url: string;
			body: string;
		}>
	>;
	listIssueComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<
		Array<{
			id: number;
			body: string;
			user: { login: string } | null;
			created_at: string;
			updated_at: string;
			html_url: string;
		}>
	>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if a user login is a known bot. */
function isBot(login: string | null | undefined): boolean {
	if (!login) return false;
	return KNOWN_BOTS.has(login);
}

/** Create an empty stats object. */
function emptyStats(): IngestStats {
	return {
		pr_review_overall: 0,
		pr_review_inline: 0,
		pr_review_reply: 0,
		pr_discussion: 0,
		lessons_added: 0,
		lessons_skipped_dedup: 0,
		lessons_skipped_empty_body: 0,
		lessons_skipped_bot: 0,
		prs_scanned: 0,
		prs_skipped_since: 0,
	};
}

/** Load cursor state from memory dir. */
function loadCursor(memoryDir: string): PRIngestCursor | null {
	const cursorPath = join(memoryDir, "pr-ingest-cursor.json");
	if (!existsSync(cursorPath)) return null;
	try {
		const raw = readFileSync(cursorPath, "utf-8");
		return JSON.parse(raw) as PRIngestCursor;
	} catch {
		return null;
	}
}

/** Save cursor state to memory dir (atomic write). */
function saveCursor(memoryDir: string, cursor: PRIngestCursor): void {
	const cursorPath = join(memoryDir, "pr-ingest-cursor.json");
	const tmpPath = `${cursorPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	writeFileSync(tmpPath, `${JSON.stringify(cursor, null, 2)}\n`, "utf-8");
	renameSync(tmpPath, cursorPath);
}

/** Build quality-preset model overrides. */
const QUALITY_PRESETS: Record<string, { extraction: string; judge: string; embed: string }> = {
	default: { extraction: "gpt-5.4-mini", judge: "gpt-5.4-nano", embed: "text-embedding-3-small" },
	high: { extraction: "gpt-5.4-mini", judge: "gpt-5.4-mini", embed: "text-embedding-3-large" },
	cheap: { extraction: "gpt-5.4-nano", judge: "gpt-5.4-nano", embed: "text-embedding-3-small" },
};

/** Build a Config for the extraction engine. */
function buildConfig(
	owner: string,
	repo: string,
	memoryDir: string,
	quality: QualityPreset,
	dryRun: boolean,
): Config {
	const preset =
		QUALITY_PRESETS[quality] ??
		QUALITY_PRESETS.default ??
		({
			extraction: "gpt-5.4-mini",
			judge: "gpt-5.4-nano",
			embed: "text-embedding-3-small",
		} as const);
	return {
		owner,
		repo,
		memory_dir: memoryDir,
		model_defaults: {
			extraction: process.env.OPENAI_EXTRACTION_MODEL ?? preset.extraction,
			judge: process.env.OPENAI_JUDGE_MODEL ?? preset.judge,
			embed: process.env.OPENAI_EMBED_MODEL ?? preset.embed,
		},
		dry_run: dryRun,
		quality,
	};
}

// ── Surface ingestion helpers ────────────────────────────────────────────────

/**
 * Ingest overall PR reviews — produces pr_review_overall Lessons.
 */
async function ingestOverallReviews(
	reviews: Array<{
		id: number;
		state: string;
		body: string;
		user: { login: string } | null;
		submitted_at: string;
		html_url: string;
	}>,
	owner: string,
	repo: string,
	prNumber: number,
	includeBots: boolean,
	adapter: MemoryAdapter | null,
	config: Config,
	dryRun: boolean,
	stats: IngestStats,
	dryRunLessons: Lesson[],
): Promise<void> {
	for (const review of reviews) {
		const reviewer = review.user?.login ?? "";

		// Bot filtering
		if (!includeBots && isBot(reviewer)) {
			stats.lessons_skipped_bot++;
			continue;
		}

		// Skip empty-body reviews
		if (!review.body || review.body.trim().length === 0) {
			stats.lessons_skipped_empty_body++;
			continue;
		}

		const source: IngestSource = {
			type: "pr_review_overall",
			owner,
			repo,
			pr_number: prNumber,
			body: review.body,
			html_url: review.html_url,
			pull_request_review_id: review.id,
			state: review.state as "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED",
			reviewer,
			submitted_at: review.submitted_at,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			// Enrich with metadata
			lesson.source_kind = "pr_review_overall";
			lesson.source_url = review.html_url;
			if (!lesson.tags.includes("pr-review")) lesson.tags.push("pr-review");
			if (!lesson.tags.includes("overall-review")) lesson.tags.push("overall-review");

			stats.pr_review_overall++;

			if (dryRun) {
				dryRunLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
				}
			}
		}
	}
}

/**
 * Ingest inline review comments — produces pr_review_inline and pr_review_reply Lessons.
 */
async function ingestReviewComments(
	comments: Array<{
		id: number;
		path: string;
		original_line: number | null;
		line: number | null;
		original_start_line: number | null;
		start_line: number | null;
		diff_hunk: string;
		commit_id: string;
		position: number | null;
		original_position: number | null;
		side: string;
		start_side: string | null;
		pull_request_review_id: number | null;
		in_reply_to_id: number | null;
		user: { login: string } | null;
		created_at: string;
		updated_at: string;
		html_url: string;
		body: string;
	}>,
	owner: string,
	repo: string,
	prNumber: number,
	includeBots: boolean,
	adapter: MemoryAdapter | null,
	config: Config,
	dryRun: boolean,
	stats: IngestStats,
	dryRunLessons: Lesson[],
): Promise<void> {
	for (const comment of comments) {
		const reviewer = comment.user?.login ?? "";

		// Bot filtering
		if (!includeBots && isBot(reviewer)) {
			stats.lessons_skipped_bot++;
			continue;
		}

		// Skip empty-body comments
		if (!comment.body || comment.body.trim().length === 0) {
			stats.lessons_skipped_empty_body++;
			continue;
		}

		const isReply = comment.in_reply_to_id !== null;
		const sourceKind = isReply ? ("pr_review_reply" as const) : ("pr_review_inline" as const);

		// Build the appropriate IngestSource
		const source: IngestSource = isReply
			? {
					type: "pr_review_reply",
					owner,
					repo,
					pr_number: prNumber,
					body: comment.body,
					html_url: comment.html_url,
					comment_id: comment.id,
					parent_comment_id: comment.in_reply_to_id as number,
					reviewer,
					created_at: comment.created_at,
					file_path: comment.path,
					diff_hunk: comment.diff_hunk,
					commit_id: comment.commit_id,
				}
			: {
					type: "pr_review_inline",
					owner,
					repo,
					pr_number: prNumber,
					body: comment.body,
					html_url: comment.html_url,
					comment_id: comment.id,
					file_path: comment.path,
					original_line: comment.original_line,
					line: comment.line,
					original_start_line: comment.original_start_line,
					start_line: comment.start_line,
					diff_hunk: comment.diff_hunk,
					commit_id: comment.commit_id,
					position: comment.position,
					original_position: comment.original_position,
					side: comment.side === "LEFT" || comment.side === "RIGHT" ? comment.side : undefined,
					start_side:
						comment.start_side === "LEFT" || comment.start_side === "RIGHT"
							? comment.start_side
							: undefined,
					pull_request_review_id: comment.pull_request_review_id,
					parent_comment_id: comment.in_reply_to_id,
					reviewer,
					created_at: comment.created_at,
					updated_at: comment.updated_at,
				};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			// Enrich with metadata
			lesson.source_kind = sourceKind;
			lesson.source_url = comment.html_url;
			if (!lesson.tags.includes("pr-review")) lesson.tags.push("pr-review");
			if (isReply && !lesson.tags.includes("reply")) lesson.tags.push("reply");
			if (!isReply && !lesson.tags.includes("inline-comment")) lesson.tags.push("inline-comment");

			// Track is_outdated for inline comments
			if (sourceKind === "pr_review_inline") {
				lesson.tags.push(comment.position === null ? "outdated" : "current");
			}

			if (isReply) {
				stats.pr_review_reply++;
			} else {
				stats.pr_review_inline++;
			}

			if (dryRun) {
				dryRunLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
				}
			}
		}
	}
}

/**
 * Ingest issue-style PR comments — produces pr_discussion Lessons.
 */
async function ingestIssueComments(
	comments: Array<{
		id: number;
		body: string;
		user: { login: string } | null;
		created_at: string;
		updated_at: string;
		html_url: string;
	}>,
	owner: string,
	repo: string,
	prNumber: number,
	includeBots: boolean,
	adapter: MemoryAdapter | null,
	config: Config,
	dryRun: boolean,
	stats: IngestStats,
	dryRunLessons: Lesson[],
): Promise<void> {
	for (const comment of comments) {
		const commenter = comment.user?.login ?? "";

		// Bot filtering
		if (!includeBots && isBot(commenter)) {
			stats.lessons_skipped_bot++;
			continue;
		}

		// Skip empty-body comments
		if (!comment.body || comment.body.trim().length === 0) {
			stats.lessons_skipped_empty_body++;
			continue;
		}

		const source: IngestSource = {
			type: "pr_discussion",
			owner,
			repo,
			pr_number: prNumber,
			comment_id: comment.id,
			commenter,
			body: comment.body,
			created_at: comment.created_at,
			html_url: comment.html_url,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			lesson.source_kind = "pr_discussion";
			lesson.source_url = comment.html_url;
			if (!lesson.tags.includes("pr-review")) lesson.tags.push("pr-review");
			if (!lesson.tags.includes("discussion")) lesson.tags.push("discussion");

			stats.pr_discussion++;

			if (dryRun) {
				dryRunLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
				}
			}
		}
	}
}

// ── Fixture loader for tests ─────────────────────────────────────────────────

/** Fixture data structure. */
export interface FixtureData {
	prs: Array<{
		number: number;
		title: string;
		state: string;
		merged: boolean;
		merged_at: string | null;
		html_url: string;
		user: { login: string } | null;
		created_at: string;
		updated_at: string;
	}>;
	reviews: Record<
		string,
		Array<{
			id: number;
			state: string;
			body: string;
			user: { login: string } | null;
			submitted_at: string;
			html_url: string;
		}>
	>;
	reviewComments: Record<
		string,
		Array<{
			id: number;
			path: string;
			original_line: number | null;
			line: number | null;
			original_start_line: number | null;
			start_line: number | null;
			diff_hunk: string;
			commit_id: string;
			position: number | null;
			original_position: number | null;
			side: string;
			start_side: string | null;
			pull_request_review_id: number | null;
			in_reply_to_id: number | null;
			user: { login: string } | null;
			created_at: string;
			updated_at: string;
			html_url: string;
			body: string;
		}>
	>;
	issueComments: Record<
		string,
		Array<{
			id: number;
			body: string;
			user: { login: string } | null;
			created_at: string;
			updated_at: string;
			html_url: string;
		}>
	>;
}

/**
 * Create a mock GitHub client from a fixture data object.
 * Returns the same interface as the real GitHubClient but reads from fixture data.
 */
export function createFixtureClient(fixture: FixtureData): GitHubClientLike {
	return {
		async listPRs(_owner: string, _repo: string, _options?: Record<string, unknown>) {
			return fixture.prs;
		},
		async listReviews(_owner: string, _repo: string, prNumber: number) {
			return fixture.reviews[String(prNumber)] ?? [];
		},
		async listReviewComments(_owner: string, _repo: string, prNumber: number) {
			return fixture.reviewComments[String(prNumber)] ?? [];
		},
		async listIssueComments(_owner: string, _repo: string, prNumber: number) {
			return fixture.issueComments[String(prNumber)] ?? [];
		},
	};
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingest PR reviews from a GitHub repository.
 *
 * This is the PRIMARY SOURCE for institutional memory. It fetches all four
 * GitHub PR-review surfaces (overall reviews, inline comments, threaded
 * replies, issue-style comments) and produces Lessons via the extraction engine.
 *
 * Features:
 * - Bot filtering (--include-bots)
 * - Idempotent on comment_id dedup
 * - Pagination via octokit.paginate
 * - Resumable via per-PR cursor
 * - --since cutoff excludes older PRs
 * - --max-prs limits PR count
 * - --dry-run prints stats without writing
 *
 * @param opts - Ingestion options
 * @param client - GitHub client (real or fixture-based)
 */
export async function ingestPrReviews(
	opts: IngestPrReviewsOptions,
	client?: GitHubClientLike,
): Promise<IngestPrReviewsResult> {
	const { owner, repo, memoryDir, quality, dryRun, includeBots, since, maxPrs } = opts;

	// ── Initialize ──────────────────────────────────────────────────

	const stats = emptyStats();
	const dryRunLessons: Lesson[] = [];
	const config = buildConfig(owner, repo, memoryDir, quality, dryRun);

	const adapterConfig: AdapterConfig = { memory_dir: memoryDir, owner, repo };
	let adapter: MemoryAdapter | null = null;

	if (!dryRun) {
		adapter = await MemoryAdapter.fromConfig(adapterConfig);
	}

	// ── Get GitHub client ───────────────────────────────────────────

	let ghClient: GitHubClientLike;
	if (client) {
		ghClient = client;
	} else {
		// Production: use the real GitHub client
		const { getGitHubClient } = await import("../github/client.js");
		ghClient = await getGitHubClient();
	}

	// ── Load cursor ─────────────────────────────────────────────────

	const cursor = loadCursor(memoryDir);

	// ── Fetch PRs ───────────────────────────────────────────────────

	info("Fetching PRs", { owner, repo });
	const allPRs = await ghClient.listPRs(owner, repo, {
		state: "closed",
		sort: "updated",
		direction: "desc",
	});

	// Filter to merged PRs only
	let mergedPRs = allPRs.filter((pr) => pr.merged && pr.merged_at !== null);

	// Apply --since filter
	if (since) {
		const sinceTime = since.getTime();
		mergedPRs = mergedPRs.filter((pr) => {
			const mergedAt = new Date(pr.merged_at as string).getTime();
			if (mergedAt < sinceTime) {
				stats.prs_skipped_since++;
				return false;
			}
			return true;
		});
	}

	// Apply cursor: skip PRs already ingested
	if (cursor) {
		mergedPRs = mergedPRs.filter((pr) => pr.number > cursor.last_pr_number);
	}

	// Apply --max-prs limit
	if (maxPrs !== undefined && maxPrs > 0) {
		mergedPRs = mergedPRs.slice(0, maxPrs);
	}

	info("PRs to process", { total: mergedPRs.length, skipped_since: stats.prs_skipped_since });

	// ── Process each PR ─────────────────────────────────────────────

	for (const pr of mergedPRs) {
		stats.prs_scanned++;
		info("Processing PR", { pr_number: pr.number, title: pr.title });

		// Fetch all four surfaces
		const [reviews, reviewComments, issueComments] = await Promise.all([
			ghClient.listReviews(owner, repo, pr.number),
			ghClient.listReviewComments(owner, repo, pr.number),
			ghClient.listIssueComments(owner, repo, pr.number),
		]);

		// Ingest each surface
		await ingestOverallReviews(
			reviews,
			owner,
			repo,
			pr.number,
			includeBots,
			adapter,
			config,
			dryRun,
			stats,
			dryRunLessons,
		);
		await ingestReviewComments(
			reviewComments,
			owner,
			repo,
			pr.number,
			includeBots,
			adapter,
			config,
			dryRun,
			stats,
			dryRunLessons,
		);
		await ingestIssueComments(
			issueComments,
			owner,
			repo,
			pr.number,
			includeBots,
			adapter,
			config,
			dryRun,
			stats,
			dryRunLessons,
		);

		// Update cursor after each PR
		if (!dryRun && pr.merged_at) {
			saveCursor(memoryDir, {
				last_pr_number: pr.number,
				last_run_at: new Date().toISOString(),
			});
		}
	}

	// ── Shutdown ────────────────────────────────────────────────────

	if (adapter) {
		await adapter.shutdown();
	}

	// ── Build output ────────────────────────────────────────────────

	const stdoutLines: string[] = [];

	if (dryRun) {
		stdoutLines.push(
			`[dry-run] Would ingest ${dryRunLessons.length} lessons across ${stats.prs_scanned} PRs.`,
		);
	} else {
		stdoutLines.push(
			`${stats.lessons_added} lessons added, ${stats.lessons_skipped_dedup} skipped (dedup), ${stats.lessons_skipped_empty_body} skipped (empty body), ${stats.lessons_skipped_bot} skipped (bot).`,
		);
	}

	stdoutLines.push(
		`  pr_review_overall: ${stats.pr_review_overall}`,
		`  pr_review_inline: ${stats.pr_review_inline}`,
		`  pr_review_reply: ${stats.pr_review_reply}`,
		`  pr_discussion: ${stats.pr_discussion}`,
		`  PRs scanned: ${stats.prs_scanned}, PRs skipped (--since): ${stats.prs_skipped_since}`,
	);

	const stdout = stdoutLines.join("\n");

	info("PR-review ingestion complete", { stats });

	return {
		exitCode: 0,
		stats,
		stdout,
	};
}
