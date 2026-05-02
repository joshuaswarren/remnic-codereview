// Tests for GitHub client — Octokit wrapper with auth, pagination, and retry.
// Uses Octokit's hook.wrap("request") to intercept requests for deterministic testing.

import * as assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Octokit } from "@octokit/rest";
import {
	createGitHubClientFromOctokit,
	GITHUB_USER_AGENT,
	type GitHubClient,
	type IssueComment,
	type PRObject,
	type ReviewComment,
	type ReviewObject,
	resetGitHubClient,
} from "./client.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PR_LIST_FIXTURE: PRObject[] = [
	{
		number: 42,
		title: "Fix null pointer dereference",
		state: "closed",
		merged: true,
		merged_at: "2026-04-15T10:30:00Z",
		html_url: "https://github.com/acme/widgets/pull/42",
		user: { login: "alice" },
		created_at: "2026-04-14T08:00:00Z",
		updated_at: "2026-04-15T11:00:00Z",
		base: { ref: "main" },
		head: { ref: "fix/null-ptr" },
	},
	{
		number: 43,
		title: "Add caching layer",
		state: "closed",
		merged: true,
		merged_at: "2026-04-16T14:20:00Z",
		html_url: "https://github.com/acme/widgets/pull/43",
		user: { login: "bob" },
		created_at: "2026-04-15T12:00:00Z",
		updated_at: "2026-04-16T15:00:00Z",
		base: { ref: "main" },
		head: { ref: "feat/caching" },
	},
];

const REVIEW_FIXTURE: ReviewObject[] = [
	{
		id: 9001,
		state: "APPROVED",
		body: "Looks good to me, but consider edge cases for null input.",
		user: { login: "reviewer-a" },
		submitted_at: "2026-04-15T09:00:00Z",
		html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-9001",
		pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/42",
	},
	{
		id: 9002,
		state: "CHANGES_REQUESTED",
		body: "Please add tests for the new function.",
		user: { login: "reviewer-b" },
		submitted_at: "2026-04-15T10:00:00Z",
		html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-9002",
		pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/42",
	},
];

const REVIEW_COMMENTS_FIXTURE: ReviewComment[] = [
	{
		id: 100001,
		path: "src/storage.ts",
		original_line: 312,
		line: 315,
		original_start_line: 312,
		start_line: 312,
		diff_hunk:
			"@@ -310,7 +310,10 @@ export function process(input: unknown) {\n-  return input.value;\n+  if (input === null || input === undefined) {\n+    throw new Error('Invalid input');\n+  }\n+  return input.value;",
		commit_id: "5849278fabcd1234567890abcdef1234567890ab",
		position: 12,
		original_position: 10,
		side: "RIGHT",
		start_side: "RIGHT",
		pull_request_review_id: 9001,
		in_reply_to_id: null,
		user: { login: "reviewer-a" },
		created_at: "2026-04-15T09:05:00Z",
		updated_at: "2026-04-15T09:05:00Z",
		html_url: "https://github.com/acme/widgets/pull/42#discussion_r100001",
		body: "This null check should use the helper function.",
	},
	{
		id: 100002,
		path: "src/storage.ts",
		original_line: 320,
		line: 320,
		original_start_line: null,
		start_line: null,
		diff_hunk:
			"@@ -318,3 +318,3 @@ export function process(input: unknown) {\n-  return input.value;\n+  return input?.value;",
		commit_id: "5849278fabcd1234567890abcdef1234567890ab",
		position: 18,
		original_position: 16,
		side: "RIGHT",
		start_side: null,
		pull_request_review_id: 9001,
		in_reply_to_id: null,
		user: { login: "reviewer-b" },
		created_at: "2026-04-15T10:05:00Z",
		updated_at: "2026-04-15T10:05:00Z",
		html_url: "https://github.com/acme/widgets/pull/42#discussion_r100002",
		body: "Optional chaining here is cleaner.",
	},
];

const REPLY_FIXTURE: ReviewComment[] = [
	{
		id: 100003,
		path: "src/storage.ts",
		original_line: 312,
		line: 315,
		original_start_line: 312,
		start_line: 312,
		diff_hunk: REVIEW_COMMENTS_FIXTURE[0]?.diff_hunk ?? "",
		commit_id: "5849278fabcd1234567890abcdef1234567890ab",
		position: 12,
		original_position: 10,
		side: "RIGHT",
		start_side: "RIGHT",
		pull_request_review_id: 9001,
		in_reply_to_id: 100001,
		user: { login: "alice" },
		created_at: "2026-04-15T09:10:00Z",
		updated_at: "2026-04-15T09:10:00Z",
		html_url: "https://github.com/acme/widgets/pull/42#discussion_r100003",
		body: "Good point, I'll refactor to use the helper.",
	},
];

const ISSUE_COMMENTS_FIXTURE: IssueComment[] = [
	{
		id: 200001,
		body: "This PR looks great overall. Just a few nits to address.",
		user: { login: "commenter-a" },
		created_at: "2026-04-15T08:30:00Z",
		updated_at: "2026-04-15T08:30:00Z",
		html_url: "https://github.com/acme/widgets/issues/42#issuecomment-200001",
	},
	{
		id: 200002,
		body: "Merging once CI passes.",
		user: { login: "alice" },
		created_at: "2026-04-15T11:00:00Z",
		updated_at: "2026-04-15T11:00:00Z",
		html_url: "https://github.com/acme/widgets/issues/42#issuecomment-200002",
	},
];

const DIFF_FIXTURE =
	"diff --git a/src/storage.ts b/src/storage.ts\nindex abc1234..def5678 100644\n--- a/src/storage.ts\n+++ b/src/storage.ts\n@@ -310,7 +310,10 @@ export function process(input: unknown) {\n-  return input.value;\n+  if (input === null || input === undefined) {\n+    throw new Error('Invalid input');\n+  }\n+  return input.value;\n";

// ── Mock infrastructure ──────────────────────────────────────────────────────

/**
 * Mock handler. Receives the Octokit route template and request options.
 * Octokit uses route templates like "/repos/{owner}/{repo}/pulls" (not expanded URLs).
 * Returns a mock response or undefined to fall through.
 */
type MockHandler = (
	route: string,
	options: Record<string, unknown>,
) => { status: number; headers?: Record<string, string>; data: unknown } | undefined;

/** The current mock handler. */
let currentHandler: MockHandler = () => undefined;

/** Track calls made. */
let callLog: Array<{ route: string; options: Record<string, unknown> }> = [];

/**
 * Create a mock Octokit that intercepts all requests via hook.wrap("request").
 * Handles both template routes (from direct calls) and expanded routes (from paginate).
 */
function createMockOctokit(userAgent?: string): Octokit {
	const octokit = new Octokit({
		auth: "ghp_test_token",
		...(userAgent ? { userAgent } : {}),
	});
	octokit.hook.wrap("request", async (_request, options) => {
		const route = (options.url ?? "") as string;
		const opts = options as Record<string, unknown>;

		callLog.push({ route, options: opts });

		const result = currentHandler(route, opts);

		if (result) {
			if (result.status >= 400) {
				const httpError = new Error(
					`HTTP ${result.status} - ${(result.data as Record<string, unknown>)?.message ?? "Error"}`,
				) as Error & {
					status: number;
					response: { data: unknown; headers: Record<string, string>; status: number };
					headers: Record<string, string>;
				};
				httpError.status = result.status;
				httpError.response = {
					data: result.data,
					headers: result.headers ?? {},
					status: result.status,
				};
				httpError.headers = result.headers ?? {};
				throw httpError;
			}
			// Return response with proper headers for paginate compatibility.
			// paginate checks response.headers.link for pagination; return empty link
			// to signal "no more pages".
			return {
				status: result.status,
				headers: { link: "", ...result.headers },
				data: result.data,
				url: route,
			};
		}

		return { status: 404, headers: { link: "" }, data: { message: "Not Found" }, url: route };
	});
	return octokit;
}

/**
 * Check if a route matches a pattern. Supports both template routes
 * (e.g. "/pulls/{pull_number}/reviews") and expanded routes
 * (e.g. "https://api.github.com/repos/acme/widgets/pulls/42/reviews").
 */
function routeMatches(route: string, pattern: string): boolean {
	// Direct template match
	if (route.includes(pattern)) return true;
	// Expanded URL match: replace {param} with a number/string regex
	const expandedPattern = pattern.replace(/\{[^}]+\}/g, "[^/]+");
	return new RegExp(expandedPattern).test(route);
}

/** Default handler that returns fixture data for standard Octokit routes. */
function standardHandler(override?: MockHandler): MockHandler {
	return (route: string, options: Record<string, unknown>) => {
		if (override) {
			const result = override(route, options);
			if (result) return result;
		}

		// POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
		if (routeMatches(route, "/pulls/{pull_number}/reviews") && options.method === "POST") {
			return {
				status: 200,
				data: {
					id: 99999,
					html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-99999",
					state: "COMMENTED",
				},
			};
		}

		// GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
		if (routeMatches(route, "/pulls/{pull_number}/reviews")) {
			return { status: 200, data: REVIEW_FIXTURE };
		}

		// GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
		if (routeMatches(route, "/pulls/{pull_number}/comments")) {
			return { status: 200, data: REVIEW_COMMENTS_FIXTURE };
		}

		// GET /repos/{owner}/{repo}/issues/{issue_number}/comments
		if (routeMatches(route, "/issues/{issue_number}/comments")) {
			return { status: 200, data: ISSUE_COMMENTS_FIXTURE };
		}

		// GET /repos/{owner}/{repo}/pulls/{pull_number} (diff) — must be exact pull_number route
		if (
			routeMatches(route, "/pulls/{pull_number}") &&
			!route.includes("/comments") &&
			!route.includes("/reviews")
		) {
			return { status: 200, data: DIFF_FIXTURE, headers: { "content-type": "application/diff" } };
		}

		// GET /repos/{owner}/{repo}/pulls (list) — must NOT match pull_number routes
		if (routeMatches(route, "/pulls") && !routeMatches(route, "/pulls/{pull_number}")) {
			return { status: 200, data: PR_LIST_FIXTURE };
		}

		return undefined;
	};
}

/** Create a test client with the standard handler + optional override. */
function createTestClient(override?: MockHandler): GitHubClient {
	callLog = [];
	setHandler(standardHandler(override));
	const octokit = createMockOctokit();
	return createGitHubClientFromOctokit(octokit);
}

/** Set the mock handler. */
function setHandler(handler: MockHandler): void {
	currentHandler = handler;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GitHubClient", () => {
	beforeEach(() => {
		callLog = [];
		currentHandler = () => undefined;
	});
	afterEach(() => {
		resetGitHubClient();
	});

	// ── listPRs ──────────────────────────────────────────────────────────────

	describe("listPRs", () => {
		it("returns array of PR objects", async () => {
			const client = createTestClient();
			const prs = await client.listPRs("acme", "widgets", { state: "closed" });

			assert.ok(Array.isArray(prs), "should return an array");
			assert.equal(prs.length, 2, "should return 2 PRs");
			assert.equal(prs[0]?.number, 42);
			assert.equal(prs[0]?.title, "Fix null pointer dereference");
			assert.equal(prs[1]?.number, 43);
		});

		it("passes state and sort parameters to the API", async () => {
			let capturedUrl = "";
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls") && !routeMatches(route, "/pulls/{pull_number}")) {
					capturedUrl = route;
					return { status: 200, data: PR_LIST_FIXTURE };
				}
				return undefined;
			});
			await client.listPRs("acme", "widgets", {
				state: "closed",
				sort: "updated",
				direction: "desc",
			});

			assert.ok(
				capturedUrl.includes("state=closed"),
				`URL should contain 'state=closed': ${capturedUrl}`,
			);
			assert.ok(
				capturedUrl.includes("sort=updated"),
				`URL should contain 'sort=updated': ${capturedUrl}`,
			);
			assert.ok(
				capturedUrl.includes("direction=desc"),
				`URL should contain 'direction=desc': ${capturedUrl}`,
			);
		});
	});

	// ── getDiff ──────────────────────────────────────────────────────────────

	describe("getDiff", () => {
		it("returns raw unified diff string", async () => {
			const client = createTestClient();
			const diff = await client.getDiff("acme", "widgets", 42);

			assert.ok(typeof diff === "string", "should return a string");
			assert.ok(diff.startsWith("diff --git"), "should start with diff header");
			assert.ok(diff.includes("src/storage.ts"), "should include file path");
		});

		it("requests PR with correct pull_number", async () => {
			let capturedOpts: Record<string, unknown> = {};
			const client = createTestClient((route, opts) => {
				if (
					routeMatches(route, "/pulls/{pull_number}") &&
					!route.includes("/comments") &&
					!route.includes("/reviews")
				) {
					capturedOpts = opts;
					return { status: 200, data: DIFF_FIXTURE };
				}
				return undefined;
			});
			await client.getDiff("acme", "widgets", 42);

			assert.equal(capturedOpts.pull_number, 42, "should request PR 42");
		});
	});

	// ── listReviews ──────────────────────────────────────────────────────────

	describe("listReviews", () => {
		it("returns review array with state, body, user, submitted_at", async () => {
			const client = createTestClient();
			const reviews = await client.listReviews("acme", "widgets", 42);

			assert.ok(Array.isArray(reviews), "should return an array");
			assert.equal(reviews.length, 2);
			assert.equal(reviews[0]?.state, "APPROVED");
			assert.equal(reviews[0]?.body, "Looks good to me, but consider edge cases for null input.");
			assert.equal(reviews[0]?.user?.login, "reviewer-a");
			assert.equal(reviews[0]?.submitted_at, "2026-04-15T09:00:00Z");
			assert.equal(reviews[1]?.state, "CHANGES_REQUESTED");
		});
	});

	// ── listReviewComments ───────────────────────────────────────────────────

	describe("listReviewComments", () => {
		it("returns inline comments with all required fields", async () => {
			const client = createTestClient();
			const comments = await client.listReviewComments("acme", "widgets", 42);

			assert.ok(Array.isArray(comments), "should return an array");
			assert.equal(comments.length, 2);

			const first = comments[0];
			assert.ok(first, "first comment should exist");
			assert.equal(first.path, "src/storage.ts");
			assert.equal(first.line, 315);
			assert.equal(first.diff_hunk, REVIEW_COMMENTS_FIXTURE[0]?.diff_hunk);
			assert.equal(first.commit_id, "5849278fabcd1234567890abcdef1234567890ab");
			assert.equal(first.position, 12);
			assert.equal(first.side, "RIGHT");
			assert.equal(first.in_reply_to_id, null);
			assert.equal(first.user?.login, "reviewer-a");
			assert.equal(first.id, 100001);
		});

		it("includes start_side for multi-line comments", async () => {
			const client = createTestClient();
			const comments = await client.listReviewComments("acme", "widgets", 42);

			const first = comments[0];
			assert.ok(first, "first comment should exist");
			assert.equal(first.start_side, "RIGHT");
			assert.equal(first.start_line, 312);
		});

		it("returns threaded replies with in_reply_to_id set", async () => {
			const allComments = [...REVIEW_COMMENTS_FIXTURE, ...REPLY_FIXTURE];
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls/{pull_number}/comments")) {
					return { status: 200, data: allComments };
				}
				return undefined;
			});
			const comments = await client.listReviewComments("acme", "widgets", 42);

			const reply = comments.find((c) => c.id === 100003);
			assert.ok(reply, "reply comment should exist");
			assert.equal(reply.in_reply_to_id, 100001);
			assert.equal(reply.body, "Good point, I'll refactor to use the helper.");
		});
	});

	// ── listIssueComments ────────────────────────────────────────────────────

	describe("listIssueComments", () => {
		it("returns issue-style comments", async () => {
			const client = createTestClient();
			const comments = await client.listIssueComments("acme", "widgets", 42);

			assert.ok(Array.isArray(comments), "should return an array");
			assert.equal(comments.length, 2);
			assert.equal(comments[0]?.body, "This PR looks great overall. Just a few nits to address.");
			assert.equal(comments[0]?.user?.login, "commenter-a");
			assert.equal(comments[0]?.id, 200001);
			assert.equal(
				comments[1]?.html_url,
				"https://github.com/acme/widgets/issues/42#issuecomment-200002",
			);
		});
	});

	// ── postReview ───────────────────────────────────────────────────────────

	describe("postReview", () => {
		it("posts a review with comments to GitHub", async () => {
			let capturedOpts: Record<string, unknown> | null = null;
			const client = createTestClient((route, opts) => {
				if (routeMatches(route, "/pulls/{pull_number}/reviews") && opts.method === "POST") {
					capturedOpts = opts;
					return {
						status: 200,
						data: {
							id: 99999,
							html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-99999",
							state: "COMMENTED",
						},
					};
				}
				return undefined;
			});

			const result = await client.postReview("acme", "widgets", 42, {
				event: "COMMENT",
				body: "Automated review by remnic-codereview",
				comments: [
					{
						path: "src/storage.ts",
						position: 12,
						body: "Consider using the helper function here.",
					},
				],
			});

			assert.ok(result, "should return a result");
			assert.equal(result.state, "COMMENTED");
			assert.ok(capturedOpts, "should have captured the request body");
			assert.equal((capturedOpts as Record<string, unknown>).event, "COMMENT");
			assert.ok(Array.isArray((capturedOpts as Record<string, unknown>).comments));
		});

		it("supports REQUEST_CHANGES event", async () => {
			const client = createTestClient((route, opts) => {
				if (routeMatches(route, "/pulls/{pull_number}/reviews") && opts.method === "POST") {
					return {
						status: 200,
						data: {
							id: 99998,
							html_url: "https://example.com",
							state: "CHANGES_REQUESTED",
						},
					};
				}
				return undefined;
			});

			const result = await client.postReview("acme", "widgets", 42, {
				event: "REQUEST_CHANGES",
				body: "Critical issue found",
				comments: [],
			});

			assert.equal(result.state, "CHANGES_REQUESTED");
		});
	});

	// ── User-agent ───────────────────────────────────────────────────────────

	describe("user-agent", () => {
		it("sets user-agent header correctly on all requests", async () => {
			const octokit = createMockOctokit(GITHUB_USER_AGENT);
			setHandler(() => ({ status: 200, data: [] }));
			const client = createGitHubClientFromOctokit(octokit);
			await client.listPRs("acme", "widgets", { state: "closed" });

			// Octokit appends the custom userAgent to its default header
			assert.ok(callLog.length >= 1, "should have made at least one request");
			const headers = (callLog[0]?.options?.headers ?? {}) as Record<string, string>;
			const ua = headers["user-agent"] ?? headers["User-Agent"] ?? "";
			assert.ok(
				ua.includes("remnic-codereview"),
				`user-agent should contain 'remnic-codereview', got '${ua}'`,
			);
		});

		it("exports GITHUB_USER_AGENT constant", () => {
			assert.ok(
				GITHUB_USER_AGENT.startsWith("remnic-codereview/"),
				`expected prefix, got ${GITHUB_USER_AGENT}`,
			);
		});
	});

	// ── listClosedIssues ──────────────────────────────────────────────────────

	describe("listClosedIssues", () => {
		const CLOSED_ISSUES_FIXTURE = [
			{
				number: 10,
				title: "Memory corruption on atomic write failure",
				body: "A power loss during write corrupted the memory store.",
				state: "closed",
				labels: [{ name: "bug" }],
				html_url: "https://github.com/acme/widgets/issues/10",
				closed_at: "2026-04-12T10:00:00Z",
				user: { login: "developer" },
			},
			{
				number: 11,
				title: "Token exposed in stderr logs",
				body: "The API key was being logged in plaintext.",
				state: "closed",
				labels: [{ name: "security" }],
				html_url: "https://github.com/acme/widgets/issues/11",
				closed_at: "2026-04-15T12:00:00Z",
				user: { login: "security-team" },
			},
			{
				number: 12,
				title: "Add support for dark mode",
				body: "Users want dark mode.",
				state: "closed",
				labels: [{ name: "enhancement" }],
				html_url: "https://github.com/acme/widgets/issues/12",
				closed_at: "2026-04-20T08:00:00Z",
				user: { login: "product" },
			},
		];

		it("returns closed issues with bug and security labels", async () => {
			const client = createTestClient((route) => {
				if (routeMatches(route, "/issues") && !route.includes("/comments")) {
					return { status: 200, data: CLOSED_ISSUES_FIXTURE.slice(0, 2) };
				}
				return undefined;
			});

			const issues = await client.listClosedIssues("acme", "widgets", ["bug", "security"]);

			assert.ok(Array.isArray(issues), "should return an array");
			assert.equal(issues.length, 2, "should return 2 issues with bug/security labels");
			assert.equal(issues[0]?.number, 10);
			assert.equal(issues[0]?.title, "Memory corruption on atomic write failure");
			assert.equal(issues[1]?.number, 11);
			assert.equal(issues[1]?.labels[0]?.name, "security");
		});

		it("passes labels and state=closed to the API", async () => {
			const client = createTestClient((route) => {
				if (routeMatches(route, "/issues") && !route.includes("/comments")) {
					return { status: 200, data: CLOSED_ISSUES_FIXTURE.slice(0, 2) };
				}
				return undefined;
			});

			await client.listClosedIssues("acme", "widgets", ["bug", "security"]);

			// Find the call to the issues endpoint
			const issueCalls = callLog.filter(
				(c) => routeMatches(c.route, "/issues") && !c.route.includes("/comments"),
			);
			assert.ok(issueCalls.length >= 1, "should have made at least one call to issues endpoint");

			const url = issueCalls[0]?.route ?? "";
			// Octokit sends query params in the URL
			assert.ok(url.includes("state=closed"), `URL should contain 'state=closed': ${url}`);
			assert.ok(url.includes("labels="), `URL should contain 'labels=': ${url}`);
		});

		it("passes since parameter when provided", async () => {
			const client = createTestClient((route) => {
				if (routeMatches(route, "/issues") && !route.includes("/comments")) {
					return { status: 200, data: [] };
				}
				return undefined;
			});

			await client.listClosedIssues("acme", "widgets", ["bug"], new Date("2026-04-01"));

			const issueCalls = callLog.filter(
				(c) => routeMatches(c.route, "/issues") && !c.route.includes("/comments"),
			);
			assert.ok(issueCalls.length >= 1, "should have made at least one call");
			const url = issueCalls[0]?.route ?? "";
			assert.ok(url.includes("since="), `URL should contain 'since=' parameter: ${url}`);
		});

		it("defaults to bug,security labels when no labels provided", async () => {
			const client = createTestClient((route) => {
				if (routeMatches(route, "/issues") && !route.includes("/comments")) {
					return { status: 200, data: [] };
				}
				return undefined;
			});

			await client.listClosedIssues("acme", "widgets");

			const issueCalls = callLog.filter(
				(c) => routeMatches(c.route, "/issues") && !c.route.includes("/comments"),
			);
			assert.ok(issueCalls.length >= 1, "should have made at least one call");
			const url = issueCalls[0]?.route ?? "";
			assert.ok(
				url.includes("bug") && url.includes("security"),
				`URL should contain default labels: ${url}`,
			);
		});

		it("retries on 5xx and eventually succeeds", async () => {
			let attemptCount = 0;
			const client = createTestClient((route) => {
				if (routeMatches(route, "/issues") && !route.includes("/comments")) {
					attemptCount++;
					if (attemptCount === 1) {
						return { status: 503, data: { message: "Service Unavailable" } };
					}
					return { status: 200, data: CLOSED_ISSUES_FIXTURE.slice(0, 1) };
				}
				return undefined;
			});

			const issues = await client.listClosedIssues("acme", "widgets", ["bug"]);

			assert.ok(Array.isArray(issues), "should succeed after retry");
			assert.ok(attemptCount >= 2, `expected >= 2 attempts, got ${attemptCount}`);
		});
	});

	// ── Auth ─────────────────────────────────────────────────────────────────

	describe("auth", () => {
		it("throws if GITHUB_TOKEN is missing", async () => {
			const { createGitHubClient } = await import("./client.js");
			await assert.rejects(() => createGitHubClient(""), /GITHUB_TOKEN/);
		});
	});

	// ── 5xx retry ────────────────────────────────────────────────────────────

	describe("5xx retry", () => {
		it("retries on 5xx responses and eventually succeeds", async () => {
			let attemptCount = 0;
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls/{pull_number}/reviews")) {
					attemptCount++;
					if (attemptCount === 1) {
						return {
							status: 503,
							data: { message: "Service Unavailable" },
						};
					}
					return { status: 200, data: REVIEW_FIXTURE };
				}
				return undefined;
			});

			const reviews = await client.listReviews("acme", "widgets", 42);

			assert.ok(Array.isArray(reviews), "should succeed after retry");
			assert.equal(reviews.length, 2);
			assert.ok(attemptCount >= 2, `expected >= 2 attempts, got ${attemptCount}`);
		});

		it("gives up after max retries on persistent 5xx", async () => {
			let attemptCount = 0;
			const maxAllowed = 6; // initial + 5 retries
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls/{pull_number}/reviews")) {
					attemptCount++;
					return {
						status: 503,
						data: { message: "Service Unavailable" },
					};
				}
				return undefined;
			});

			await assert.rejects(() => client.listReviews("acme", "widgets", 42), /503|failed after/i);

			assert.equal(
				attemptCount,
				maxAllowed,
				`should make exactly 6 attempts (1 + 5 retries), got ${attemptCount}`,
			);
		});
	});

	// ── 403 Retry-After ──────────────────────────────────────────────────────

	describe("403 secondary rate limit", () => {
		it("honors Retry-After header on 403 secondary rate limit", async () => {
			let attemptCount = 0;
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls/{pull_number}/comments")) {
					attemptCount++;
					if (attemptCount === 1) {
						return {
							status: 403,
							headers: { "retry-after": "1" },
							data: {
								message: "You have exceeded a secondary rate limit.",
								documentation_url:
									"https://docs.github.com/rest/overview/resources-in-the-api#secondary-rate-limits",
							},
						};
					}
					return { status: 200, data: REVIEW_COMMENTS_FIXTURE };
				}
				return undefined;
			});

			const start = Date.now();
			const comments = await client.listReviewComments("acme", "widgets", 42);
			const elapsed = Date.now() - start;

			assert.ok(Array.isArray(comments), "should succeed after rate limit wait");
			assert.ok(elapsed >= 800, `expected >= 800ms elapsed, got ${elapsed}ms`);
			assert.ok(attemptCount >= 2, "should have retried at least once");
		});

		it("throws on non-rate-limit 403", async () => {
			const client = createTestClient((route) => {
				if (routeMatches(route, "/pulls/{pull_number}/comments")) {
					return {
						status: 403,
						data: { message: "Must have admin rights to Repository." },
					};
				}
				return undefined;
			});

			await assert.rejects(() => client.listReviewComments("acme", "widgets", 42), /403/);
		});
	});
});
