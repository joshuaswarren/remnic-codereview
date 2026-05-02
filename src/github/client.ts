// GitHub client — Octokit wrapper with auth from GITHUB_TOKEN.
// Rate-limit aware: 5xx retry with backoff, 403 Retry-After honoring.
// Uses octokit.paginate(). Sets user-agent header.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import * as log from "../log.js";

// ── Package version for user-agent ──────────────────────────────────────────

let pkgVersion = "0.0.0";
try {
	const pkgPath = resolve(import.meta.dirname ?? ".", "../../package.json");
	const raw = readFileSync(pkgPath, "utf-8");
	const parsed = JSON.parse(raw) as { version?: string };
	if (typeof parsed.version === "string") {
		pkgVersion = parsed.version;
	}
} catch {
	// Fallback — version unknown
}

/** User-agent string for all GitHub requests. */
export const GITHUB_USER_AGENT = `remnic-codereview/${pkgVersion}`;

// ── Retry constants ─────────────────────────────────────────────────────────

/** Maximum number of retries for 5xx responses. */
const MAX_RETRIES = 5;

/** Base delay in ms for exponential backoff. */
const BASE_DELAY_MS = 1000;

// ── Types ────────────────────────────────────────────────────────────────────

/** PR object returned by listPRs. */
export interface PRObject {
	number: number;
	title: string;
	state: string;
	merged: boolean;
	merged_at: string | null;
	html_url: string;
	user: { login: string } | null;
	created_at: string;
	updated_at: string;
	base: { ref: string };
	head: { ref: string };
	[key: string]: unknown;
}

/** Review object returned by listReviews. */
export interface ReviewObject {
	id: number;
	state: string;
	body: string;
	user: { login: string } | null;
	submitted_at: string;
	html_url: string;
	pull_request_url: string;
	[key: string]: unknown;
}

/** Review comment (inline) returned by listReviewComments. */
export interface ReviewComment {
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
	[key: string]: unknown;
}

/** Issue comment returned by listIssueComments. */
export interface IssueComment {
	id: number;
	body: string;
	user: { login: string } | null;
	created_at: string;
	updated_at: string;
	html_url: string;
	[key: string]: unknown;
}

/** Input for posting a review comment. */
export interface PostReviewComment {
	path: string;
	position?: number;
	line?: number;
	side?: string;
	start_line?: number;
	start_side?: string;
	body: string;
}

/** Input for posting a review. */
export interface PostReviewInput {
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
	comments: PostReviewComment[];
}

/** Result of posting a review. */
export interface PostReviewResult {
	id: number;
	html_url: string;
	state: string;
	[key: string]: unknown;
}

/** Options for listPRs. */
export interface ListPRsOptions {
	state?: "open" | "closed" | "all";
	sort?: "created" | "updated" | "popularity" | "long-running";
	direction?: "asc" | "desc";
	per_page?: number;
	since?: string;
}

// ── Retry helpers ────────────────────────────────────────────────────────────

/** Sleep for the specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a response is a secondary rate limit error.
 * GitHub returns 403 with specific message and Retry-After header.
 */
function isSecondaryRateLimit(status: number, data: unknown): boolean {
	if (status !== 403) return false;
	if (typeof data === "object" && data !== null) {
		const msg = (data as Record<string, unknown>).message;
		if (typeof msg === "string" && msg.toLowerCase().includes("secondary rate limit")) {
			return true;
		}
		const docUrl = (data as Record<string, unknown>).documentation_url;
		if (typeof docUrl === "string" && docUrl.includes("secondary-rate-limits")) {
			return true;
		}
	}
	return false;
}

// ── GitHubClient ─────────────────────────────────────────────────────────────

/** Octokit wrapper with auth, pagination, retry, and rate-limit handling. */
export interface GitHubClient {
	listPRs(owner: string, repo: string, options?: ListPRsOptions): Promise<PRObject[]>;
	getDiff(owner: string, repo: string, prNumber: number): Promise<string>;
	listReviews(owner: string, repo: string, prNumber: number): Promise<ReviewObject[]>;
	listReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]>;
	listIssueComments(owner: string, repo: string, prNumber: number): Promise<IssueComment[]>;
	postReview(
		owner: string,
		repo: string,
		prNumber: number,
		input: PostReviewInput,
	): Promise<PostReviewResult>;
}

/** No-op reset for test symmetry. */
export function resetGitHubClient(): void {
	// No-op
}

/**
 * Create a GitHub client wrapping the given Octokit instance.
 *
 * The client provides:
 * - Automatic pagination via octokit.paginate()
 * - 5xx retry with exponential backoff (max 5 retries)
 * - 403 secondary-rate-limit honoring Retry-After header
 *
 * @param octokit - A pre-configured Octokit instance (with auth and user-agent)
 */
export function createGitHubClientFromOctokit(octokit: Octokit): GitHubClient {
	/**
	 * Execute an Octokit request with retry logic.
	 * - 5xx: retry with exponential backoff up to MAX_RETRIES
	 * - 403 secondary rate limit: sleep for Retry-After seconds then retry
	 * - 403 other: throw immediately
	 * - Other errors: throw immediately
	 */
	async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await fn();
			} catch (err: unknown) {
				lastError = err;

				const httpError = err as {
					status?: number;
					headers?: Record<string, string>;
					message?: string;
					response?: { data?: unknown; headers?: Record<string, string> };
				};
				const status = httpError.status;

				if (status === undefined) {
					throw err;
				}

				// 403 secondary rate limit
				if (status === 403) {
					const body = httpError.response?.data ?? { message: httpError.message };
					if (isSecondaryRateLimit(status, body)) {
						const retryAfterStr =
							httpError.headers?.["retry-after"] ?? httpError.response?.headers?.["retry-after"];
						const retryAfterSec = retryAfterStr ? Number.parseInt(retryAfterStr, 10) : 60;
						const retryAfterMs = retryAfterSec * 1000;

						log.info("secondary_rate_limit_sleep", {
							retry_after_ms: retryAfterMs,
							attempt,
						});

						await sleep(retryAfterMs);
						continue;
					}
					// Non-rate-limit 403 — throw immediately
					throw err;
				}

				// 5xx — retry with backoff
				if (status >= 500 && status < 600) {
					if (attempt < MAX_RETRIES) {
						const delay = BASE_DELAY_MS * 2 ** attempt;
						log.warn("5xx_retry", {
							status,
							attempt: attempt + 1,
							max_retries: MAX_RETRIES,
							delay_ms: delay,
						});
						await sleep(delay);
						continue;
					}
					throw new Error(
						`GitHub API request failed after ${MAX_RETRIES} retries (last status: ${status}): ${httpError.message ?? "unknown error"}`,
					);
				}

				// Other errors — throw immediately
				throw err;
			}
		}
		throw lastError;
	}

	return {
		async listPRs(owner: string, repo: string, options?: ListPRsOptions): Promise<PRObject[]> {
			return withRetry(() =>
				octokit.paginate(octokit.rest.pulls.list, {
					owner,
					repo,
					state: options?.state ?? "closed",
					sort: options?.sort ?? "updated",
					direction: options?.direction ?? "desc",
					per_page: options?.per_page ?? 100,
				}),
			) as Promise<unknown> as Promise<PRObject[]>;
		},

		async getDiff(owner: string, repo: string, prNumber: number): Promise<string> {
			return withRetry(async () => {
				const { data } = await octokit.rest.pulls.get({
					owner,
					repo,
					pull_number: prNumber,
					mediaType: { format: "diff" },
				});
				return data as unknown as string;
			});
		},

		async listReviews(owner: string, repo: string, prNumber: number): Promise<ReviewObject[]> {
			return withRetry(() =>
				octokit.paginate(octokit.rest.pulls.listReviews, {
					owner,
					repo,
					pull_number: prNumber,
				}),
			) as Promise<unknown> as Promise<ReviewObject[]>;
		},

		async listReviewComments(
			owner: string,
			repo: string,
			prNumber: number,
		): Promise<ReviewComment[]> {
			return withRetry(() =>
				octokit.paginate(octokit.rest.pulls.listReviewComments, {
					owner,
					repo,
					pull_number: prNumber,
				}),
			) as Promise<unknown> as Promise<ReviewComment[]>;
		},

		async listIssueComments(
			owner: string,
			repo: string,
			prNumber: number,
		): Promise<IssueComment[]> {
			return withRetry(() =>
				octokit.paginate(octokit.rest.issues.listComments, {
					owner,
					repo,
					issue_number: prNumber,
				}),
			) as Promise<unknown> as Promise<IssueComment[]>;
		},

		async postReview(
			owner: string,
			repo: string,
			prNumber: number,
			input: PostReviewInput,
		): Promise<PostReviewResult> {
			return withRetry(async () => {
				const { data } = await octokit.rest.pulls.createReview({
					owner,
					repo,
					pull_number: prNumber,
					event: input.event,
					body: input.body,
					comments: input.comments.map((c) => ({
						path: c.path,
						...(c.position !== undefined ? { position: c.position } : {}),
						...(c.line !== undefined ? { line: c.line } : {}),
						...(c.side !== undefined ? { side: c.side } : {}),
						...(c.start_line !== undefined ? { start_line: c.start_line } : {}),
						...(c.start_side !== undefined ? { start_side: c.start_side } : {}),
						body: c.body,
					})),
				});
				return {
					id: data.id,
					html_url: data.html_url ?? "",
					state: data.state ?? "",
				};
			});
		},
	};
}

/**
 * Create a GitHub client with the given token.
 * Sets user-agent to "remnic-codereview/<version>".
 *
 * @param token - GitHub personal access token
 * @param _customFetch - Unused (kept for API compat; tests inject Octokit directly)
 */
export async function createGitHubClient(
	token: string,
	_customFetch?: typeof fetch,
): Promise<GitHubClient> {
	if (!token) {
		throw new Error("GITHUB_TOKEN is not set. Set it in your environment or secrets.env.");
	}

	const octokit = new Octokit({
		auth: token,
		userAgent: GITHUB_USER_AGENT,
	});

	return createGitHubClientFromOctokit(octokit);
}

/**
 * Get or create a GitHub client using GITHUB_TOKEN from the environment.
 * Convenience wrapper for non-test usage.
 */
export async function getGitHubClient(): Promise<GitHubClient> {
	const token = process.env.GITHUB_TOKEN ?? "";
	return createGitHubClient(token);
}
