// Unit tests for src/ingest/pr-reviews.ts
// Uses OPENAI_JUDGE_STUB=1 for deterministic extraction.
// Tests against fixture data (not real GitHub API).

import * as assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { describe, it } from "node:test";
import { MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import {
	createFixtureClient,
	type FixtureData,
	type IngestStats,
	ingestPrReviews,
} from "./pr-reviews.js";

// ── Test environment ─────────────────────────────────────────────────────────

process.env.OPENAI_JUDGE_STUB = "1";

let tmpDirCounter = 0;
function makeTmpDir(): string {
	tmpDirCounter++;
	const dir = `/tmp/remnic-codereview-test-pr-reviews-${process.pid}-${tmpDirCounter}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

const SINGLE_OVERALL_REVIEW: FixtureData = {
	prs: [
		{
			number: 1,
			title: "Fix bug",
			state: "closed",
			merged: true,
			merged_at: "2026-03-15T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/1",
			user: { login: "alice" },
			created_at: "2026-03-14T08:00:00Z",
			updated_at: "2026-03-15T10:00:00Z",
		},
	],
	reviews: {
		"1": [
			{
				id: 1001,
				state: "COMMENTED",
				body: "Consider using a guard clause.",
				user: { login: "bob" },
				submitted_at: "2026-03-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/1#pullrequestreview-1001",
			},
		],
	},
	reviewComments: { "1": [] },
	issueComments: { "1": [] },
};

const SINGLE_INLINE_COMMENT: FixtureData = {
	prs: [
		{
			number: 2,
			title: "Add feature",
			state: "closed",
			merged: true,
			merged_at: "2026-03-20T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/2",
			user: { login: "alice" },
			created_at: "2026-03-19T08:00:00Z",
			updated_at: "2026-03-20T10:00:00Z",
		},
	],
	reviews: { "2": [] },
	reviewComments: {
		"2": [
			{
				id: 2001,
				path: "src/storage.ts",
				original_line: 312,
				line: 315,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -310,5 +310,8 @@\n+  const data = items.slice(-n);\n+  return data;",
				commit_id: "5849278fa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
				position: 5,
				original_position: 5,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "bob" },
				created_at: "2026-03-20T09:00:00Z",
				updated_at: "2026-03-20T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/2#discussion_r2001",
				body: "slice(-n) when n=0 returns empty array. Add a guard.",
			},
		],
	},
	issueComments: { "2": [] },
};

const MULTI_LINE_INLINE: FixtureData = {
	prs: [
		{
			number: 3,
			title: "Multi-line",
			state: "closed",
			merged: true,
			merged_at: "2026-04-01T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/3",
			user: { login: "alice" },
			created_at: "2026-03-31T08:00:00Z",
			updated_at: "2026-04-01T10:00:00Z",
		},
	],
	reviews: { "3": [] },
	reviewComments: {
		"3": [
			{
				id: 3001,
				path: "src/parser.ts",
				original_line: 47,
				line: 47,
				original_start_line: 42,
				start_line: 42,
				diff_hunk: "@@ -42,5 +42,8 @@\n+  multi-line\n+  comment\n+  range",
				commit_id: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
				position: 4,
				original_position: 4,
				side: "RIGHT",
				start_side: "RIGHT",
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "bob" },
				created_at: "2026-04-01T09:00:00Z",
				updated_at: "2026-04-01T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/3#discussion_r3001",
				body: "Multi-line comment spanning lines 42-47.",
			},
		],
	},
	issueComments: { "3": [] },
};

const INLINE_WITH_REPLY: FixtureData = {
	prs: [
		{
			number: 4,
			title: "Reply test",
			state: "closed",
			merged: true,
			merged_at: "2026-04-05T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/4",
			user: { login: "alice" },
			created_at: "2026-04-04T08:00:00Z",
			updated_at: "2026-04-05T10:00:00Z",
		},
	],
	reviews: { "4": [] },
	reviewComments: {
		"4": [
			{
				id: 4001,
				path: "src/app.ts",
				original_line: 20,
				line: 20,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -18,3 +18,4 @@\n+  // comment",
				commit_id: "cccccccccccccccccccccccccccccccccccccccc",
				position: 2,
				original_position: 2,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "bob" },
				created_at: "2026-04-05T09:00:00Z",
				updated_at: "2026-04-05T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/4#discussion_r4001",
				body: "What about null?",
			},
			{
				id: 4002,
				path: "src/app.ts",
				original_line: 20,
				line: 20,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -18,3 +18,4 @@\n+  // comment",
				commit_id: "cccccccccccccccccccccccccccccccccccccccc",
				position: 2,
				original_position: 2,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: 4001,
				user: { login: "alice" },
				created_at: "2026-04-05T09:30:00Z",
				updated_at: "2026-04-05T09:30:00Z",
				html_url: "https://github.com/acme/widgets/pull/4#discussion_r4002",
				body: "Good catch! I'll add a null guard.",
			},
		],
	},
	issueComments: { "4": [] },
};

const ISSUE_COMMENTS_ONLY: FixtureData = {
	prs: [
		{
			number: 5,
			title: "Discussion",
			state: "closed",
			merged: true,
			merged_at: "2026-04-10T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/5",
			user: { login: "alice" },
			created_at: "2026-04-09T08:00:00Z",
			updated_at: "2026-04-10T10:00:00Z",
		},
	],
	reviews: { "5": [] },
	reviewComments: { "5": [] },
	issueComments: {
		"5": [
			{
				id: 5001,
				body: "Looks good. Just a typo.",
				user: { login: "charlie" },
				created_at: "2026-04-10T09:00:00Z",
				updated_at: "2026-04-10T09:00:00Z",
				html_url: "https://github.com/acme/widgets/issues/5#issuecomment-5001",
			},
			{
				id: 5002,
				body: "Fixed. Thanks!",
				user: { login: "alice" },
				created_at: "2026-04-10T09:30:00Z",
				updated_at: "2026-04-10T09:30:00Z",
				html_url: "https://github.com/acme/widgets/issues/5#issuecomment-5002",
			},
		],
	},
};

const BOT_COMMENTS: FixtureData = {
	prs: [
		{
			number: 6,
			title: "Bot test",
			state: "closed",
			merged: true,
			merged_at: "2026-04-15T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/6",
			user: { login: "dependabot[bot]" },
			created_at: "2026-04-14T08:00:00Z",
			updated_at: "2026-04-15T10:00:00Z",
		},
	],
	reviews: {
		"6": [
			{
				id: 6001,
				state: "APPROVED",
				body: "LGTM from codeql.",
				user: { login: "codeql" },
				submitted_at: "2026-04-15T08:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/6#pullrequestreview-6001",
			},
			{
				id: 6002,
				state: "COMMENTED",
				body: "Human review: safe.",
				user: { login: "bob" },
				submitted_at: "2026-04-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/6#pullrequestreview-6002",
			},
		],
	},
	reviewComments: {
		"6": [
			{
				id: 6003,
				path: "package.json",
				original_line: 10,
				line: 10,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -8,3 +8,3 @@\n+  change",
				commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				position: 1,
				original_position: 1,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "chatgpt-codex-connector[bot]" },
				created_at: "2026-04-15T08:30:00Z",
				updated_at: "2026-04-15T08:30:00Z",
				html_url: "https://github.com/acme/widgets/pull/6#discussion_r6003",
				body: "Fine.",
			},
			{
				id: 6004,
				path: "package.json",
				original_line: 10,
				line: 10,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -8,3 +8,3 @@\n+  change",
				commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				position: 1,
				original_position: 1,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "cursor[bot]" },
				created_at: "2026-04-15T08:40:00Z",
				updated_at: "2026-04-15T08:40:00Z",
				html_url: "https://github.com/acme/widgets/pull/6#discussion_r6004",
				body: "No issues.",
			},
			{
				id: 6005,
				path: "package.json",
				original_line: 10,
				line: 10,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -8,3 +8,3 @@\n+  change",
				commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				position: 1,
				original_position: 1,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "bob" },
				created_at: "2026-04-15T09:00:00Z",
				updated_at: "2026-04-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/6#discussion_r6005",
				body: "Safe.",
			},
		],
	},
	issueComments: {
		"6": [
			{
				id: 6006,
				body: "Auto-merged.",
				user: { login: "dependabot[bot]" },
				created_at: "2026-04-15T07:00:00Z",
				updated_at: "2026-04-15T07:00:00Z",
				html_url: "https://github.com/acme/widgets/issues/6#issuecomment-6006",
			},
			{
				id: 6007,
				body: "Thanks!",
				user: { login: "github-actions[bot]" },
				created_at: "2026-04-15T07:30:00Z",
				updated_at: "2026-04-15T07:30:00Z",
				html_url: "https://github.com/acme/widgets/issues/6#issuecomment-6007",
			},
		],
	},
};

const EMPTY_BODY_REVIEW: FixtureData = {
	prs: [
		{
			number: 7,
			title: "Empty review",
			state: "closed",
			merged: true,
			merged_at: "2026-04-20T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/7",
			user: { login: "alice" },
			created_at: "2026-04-19T08:00:00Z",
			updated_at: "2026-04-20T10:00:00Z",
		},
	],
	reviews: {
		"7": [
			{
				id: 7001,
				state: "APPROVED",
				body: "",
				user: { login: "bob" },
				submitted_at: "2026-04-20T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/7#pullrequestreview-7001",
			},
		],
	},
	reviewComments: { "7": [] },
	issueComments: { "7": [] },
};

const OUTDATED_INLINE: FixtureData = {
	prs: [
		{
			number: 8,
			title: "Outdated",
			state: "closed",
			merged: true,
			merged_at: "2026-04-25T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/8",
			user: { login: "alice" },
			created_at: "2026-04-24T08:00:00Z",
			updated_at: "2026-04-25T10:00:00Z",
		},
	],
	reviews: { "8": [] },
	reviewComments: {
		"8": [
			{
				id: 8001,
				path: "src/app.ts",
				original_line: 20,
				line: null,
				original_start_line: null,
				start_line: null,
				diff_hunk: "@@ -18,3 +18,3 @@\n-  old\n+  new",
				commit_id: "dddddddddddddddddddddddddddddddddddddddd",
				position: null,
				original_position: 2,
				side: "RIGHT",
				start_side: null,
				pull_request_review_id: null,
				in_reply_to_id: null,
				user: { login: "bob" },
				created_at: "2026-04-25T09:00:00Z",
				updated_at: "2026-04-25T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/8#discussion_r8001",
				body: "This was on an old version of the diff.",
			},
		],
	},
	issueComments: { "8": [] },
};

const SINCE_CUTOFF: FixtureData = {
	prs: [
		{
			number: 20,
			title: "Old",
			state: "closed",
			merged: true,
			merged_at: "2026-01-15T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/20",
			user: { login: "alice" },
			created_at: "2026-01-14T08:00:00Z",
			updated_at: "2026-01-15T10:00:00Z",
		},
		{
			number: 21,
			title: "Medium",
			state: "closed",
			merged: true,
			merged_at: "2026-02-15T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/21",
			user: { login: "alice" },
			created_at: "2026-02-14T08:00:00Z",
			updated_at: "2026-02-15T10:00:00Z",
		},
		{
			number: 22,
			title: "Recent",
			state: "closed",
			merged: true,
			merged_at: "2026-03-15T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/22",
			user: { login: "alice" },
			created_at: "2026-03-14T08:00:00Z",
			updated_at: "2026-03-15T10:00:00Z",
		},
	],
	reviews: {
		"20": [
			{
				id: 20001,
				state: "APPROVED",
				body: "Old review",
				user: { login: "bob" },
				submitted_at: "2026-01-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/20#pullrequestreview-20001",
			},
		],
		"21": [
			{
				id: 21001,
				state: "COMMENTED",
				body: "Medium review",
				user: { login: "bob" },
				submitted_at: "2026-02-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/21#pullrequestreview-21001",
			},
		],
		"22": [
			{
				id: 22001,
				state: "COMMENTED",
				body: "Recent review",
				user: { login: "bob" },
				submitted_at: "2026-03-15T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/22#pullrequestreview-22001",
			},
		],
	},
	reviewComments: { "20": [], "21": [], "22": [] },
	issueComments: { "20": [], "21": [], "22": [] },
};

const MANY_PRS: FixtureData = {
	prs: [
		{
			number: 30,
			title: "PR 1",
			state: "closed",
			merged: true,
			merged_at: "2026-04-01T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/30",
			user: { login: "alice" },
			created_at: "2026-03-31T08:00:00Z",
			updated_at: "2026-04-01T10:00:00Z",
		},
		{
			number: 31,
			title: "PR 2",
			state: "closed",
			merged: true,
			merged_at: "2026-04-02T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/31",
			user: { login: "alice" },
			created_at: "2026-04-01T08:00:00Z",
			updated_at: "2026-04-02T10:00:00Z",
		},
		{
			number: 32,
			title: "PR 3",
			state: "closed",
			merged: true,
			merged_at: "2026-04-03T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/32",
			user: { login: "alice" },
			created_at: "2026-04-02T08:00:00Z",
			updated_at: "2026-04-03T10:00:00Z",
		},
		{
			number: 33,
			title: "PR 4",
			state: "closed",
			merged: true,
			merged_at: "2026-04-04T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/33",
			user: { login: "alice" },
			created_at: "2026-04-03T08:00:00Z",
			updated_at: "2026-04-04T10:00:00Z",
		},
		{
			number: 34,
			title: "PR 5",
			state: "closed",
			merged: true,
			merged_at: "2026-04-05T10:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/34",
			user: { login: "alice" },
			created_at: "2026-04-04T08:00:00Z",
			updated_at: "2026-04-05T10:00:00Z",
		},
	],
	reviews: {
		"30": [
			{
				id: 30001,
				state: "APPROVED",
				body: "R1",
				user: { login: "bob" },
				submitted_at: "2026-04-01T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/30#pullrequestreview-30001",
			},
		],
		"31": [
			{
				id: 31001,
				state: "APPROVED",
				body: "R2",
				user: { login: "bob" },
				submitted_at: "2026-04-02T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/31#pullrequestreview-31001",
			},
		],
		"32": [
			{
				id: 32001,
				state: "APPROVED",
				body: "R3",
				user: { login: "bob" },
				submitted_at: "2026-04-03T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/32#pullrequestreview-32001",
			},
		],
		"33": [
			{
				id: 33001,
				state: "APPROVED",
				body: "R4",
				user: { login: "bob" },
				submitted_at: "2026-04-04T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/33#pullrequestreview-33001",
			},
		],
		"34": [
			{
				id: 34001,
				state: "APPROVED",
				body: "R5",
				user: { login: "bob" },
				submitted_at: "2026-04-05T09:00:00Z",
				html_url: "https://github.com/acme/widgets/pull/34#pullrequestreview-34001",
			},
		],
	},
	reviewComments: { "30": [], "31": [], "32": [], "33": [], "34": [] },
	issueComments: { "30": [], "31": [], "32": [], "33": [], "34": [] },
};

// ── Helper: ingest and list lessons ──────────────────────────────────────────

interface TestResult {
	stats: IngestStats;
	stdout: string;
	lessons: Lesson[];
	memoryDir: string;
}

async function ingestAndList(
	fixture: FixtureData,
	opts: { includeBots?: boolean; since?: Date; maxPrs?: number; dryRun?: boolean } = {},
): Promise<TestResult> {
	const memoryDir = makeTmpDir();
	const client = createFixtureClient(fixture);
	const result = await ingestPrReviews(
		{
			owner: "acme",
			repo: "widgets",
			memoryDir,
			quality: "default",
			dryRun: opts.dryRun ?? false,
			includeBots: opts.includeBots ?? false,
			since: opts.since,
			maxPrs: opts.maxPrs,
		},
		client,
	);

	let lessons: Lesson[] = [];
	if (!opts.dryRun) {
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: memoryDir,
			owner: "acme",
			repo: "widgets",
		});
		const listResult = await adapter.listLessons({ limit: 1000 });
		lessons = listResult.items;
		await adapter.shutdown();
	}

	return { stats: result.stats, stdout: result.stdout, lessons, memoryDir };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pr-review ingestion", () => {
	// ── Surface 1: Overall reviews ────────────────────────────────────

	it("extracts overall PR review as pr_review_overall Lesson", async () => {
		const { lessons, stats } = await ingestAndList(SINGLE_OVERALL_REVIEW);
		assert.ok(stats.pr_review_overall >= 1, "should produce at least 1 overall review lesson");
		assert.ok(stats.lessons_added >= 1, "should add at least 1 lesson");
		const overallLesson = lessons.find((l) => l.source_kind === "pr_review_overall");
		assert.ok(overallLesson, "should have a pr_review_overall lesson");
		assert.equal(
			overallLesson.source_url,
			"https://github.com/acme/widgets/pull/1#pullrequestreview-1001",
		);
		// Verify metadata fields
		assert.ok(overallLesson.metadata, "lesson should have metadata");
		assert.equal(overallLesson.metadata.pull_request_review_id, 1001);
		assert.equal(overallLesson.metadata.state, "COMMENTED");
		assert.deepEqual(overallLesson.metadata.reviewer, { login: "bob" });
		assert.equal(overallLesson.metadata.submitted_at, "2026-03-15T09:00:00Z");
		assert.equal(
			overallLesson.metadata.html_url,
			"https://github.com/acme/widgets/pull/1#pullrequestreview-1001",
		);
	});

	it("skips empty-body overall review", async () => {
		const { stats } = await ingestAndList(EMPTY_BODY_REVIEW);
		assert.equal(stats.pr_review_overall, 0, "should produce zero overall review lessons");
		assert.equal(stats.lessons_skipped_empty_body, 1, "should skip 1 empty body review");
	});

	// ── Surface 2: Inline comments ────────────────────────────────────

	it("extracts inline comment as pr_review_inline Lesson", async () => {
		const { lessons, stats } = await ingestAndList(SINGLE_INLINE_COMMENT);
		assert.ok(stats.pr_review_inline >= 1, "should produce at least 1 inline lesson");
		const inlineLesson = lessons.find((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLesson, "should have a pr_review_inline lesson");
		assert.ok(inlineLesson.tags.includes("inline-comment"), "should have inline-comment tag");
		assert.ok(inlineLesson.tags.includes("current"), "should have current tag (not outdated)");
		// Verify metadata fields
		assert.ok(inlineLesson.metadata, "lesson should have metadata");
		assert.equal(inlineLesson.metadata.comment_id, 2001);
		assert.equal(inlineLesson.metadata.file_path, "src/storage.ts");
		assert.equal(inlineLesson.metadata.original_line, 312);
		assert.equal(inlineLesson.metadata.line, 315);
		assert.equal(inlineLesson.metadata.position, 5);
		assert.equal(inlineLesson.metadata.side, "RIGHT");
		assert.equal(inlineLesson.metadata.commit_id, "5849278fa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
		assert.ok(
			typeof inlineLesson.metadata.diff_hunk === "string" &&
				inlineLesson.metadata.diff_hunk.length > 0,
			"diff_hunk should be a non-empty string",
		);
		assert.equal(inlineLesson.metadata.is_outdated, false);
		assert.equal(inlineLesson.metadata.parent_comment_id, null);
		assert.equal(inlineLesson.metadata.original_position, 5);
		assert.deepEqual(inlineLesson.metadata.reviewer, { login: "bob" });
		assert.equal(inlineLesson.metadata.created_at, "2026-03-20T09:00:00Z");
		assert.equal(inlineLesson.metadata.updated_at, "2026-03-20T09:00:00Z");
	});

	it("preserves multi-line start_line/end_line range in source_kind", async () => {
		const { lessons } = await ingestAndList(MULTI_LINE_INLINE);
		const inlineLesson = lessons.find((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLesson, "should have an inline lesson");
		assert.equal(inlineLesson.source_kind, "pr_review_inline");
		// Verify metadata has multi-line range
		assert.ok(inlineLesson.metadata, "lesson should have metadata");
		assert.equal(inlineLesson.metadata.start_line, 42);
		assert.equal(inlineLesson.metadata.line, 47);
		assert.equal(inlineLesson.metadata.original_start_line, 42);
		assert.equal(inlineLesson.metadata.original_line, 47);
		assert.equal(inlineLesson.metadata.side, "RIGHT");
		assert.equal(inlineLesson.metadata.start_side, "RIGHT");
	});

	it("flags outdated inline comment (position null)", async () => {
		const { lessons, stats } = await ingestAndList(OUTDATED_INLINE);
		assert.ok(stats.pr_review_inline >= 1, "should produce at least 1 inline lesson");
		const inlineLesson = lessons.find((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLesson, "should have an inline lesson");
		assert.ok(inlineLesson.tags.includes("outdated"), "should tag as outdated");
		// Verify metadata: is_outdated should be true, position null
		assert.ok(inlineLesson.metadata, "lesson should have metadata");
		assert.equal(inlineLesson.metadata.is_outdated, true);
		assert.equal(inlineLesson.metadata.position, null);
		assert.equal(inlineLesson.metadata.original_position, 2);
	});

	// ── Surface 3: Threaded replies ───────────────────────────────────

	it("extracts reply as pr_review_reply with parent_comment_id", async () => {
		const { lessons, stats } = await ingestAndList(INLINE_WITH_REPLY);
		assert.ok(stats.pr_review_inline >= 1, "should produce at least 1 inline lesson");
		assert.ok(stats.pr_review_reply >= 1, "should produce at least 1 reply lesson");

		const replyLesson = lessons.find((l) => l.source_kind === "pr_review_reply");
		assert.ok(replyLesson, "should have a pr_review_reply lesson");
		assert.ok(replyLesson.tags.includes("reply"), "should have reply tag");
		// Verify metadata: parent_comment_id set
		assert.ok(replyLesson.metadata, "reply lesson should have metadata");
		assert.equal(replyLesson.metadata.parent_comment_id, 4001);
		assert.equal(replyLesson.metadata.comment_id, 4002);

		// Verify original inline comment has parent_comment_id null
		const inlineLesson = lessons.find((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLesson, "should have a pr_review_inline lesson");
		assert.ok(inlineLesson.metadata, "inline lesson should have metadata");
		assert.equal(inlineLesson.metadata.parent_comment_id, null);
		assert.equal(inlineLesson.metadata.comment_id, 4001);
	});

	// ── Surface 4: Issue-style comments ───────────────────────────────

	it("extracts issue-style comments as pr_discussion Lessons", async () => {
		const { lessons, stats } = await ingestAndList(ISSUE_COMMENTS_ONLY);
		assert.ok(stats.pr_discussion >= 2, "should produce at least 2 discussion lessons");
		const discussionLessons = lessons.filter((l) => l.source_kind === "pr_discussion");
		assert.ok(discussionLessons.length >= 2, "should have at least 2 pr_discussion lessons");
		for (const lesson of discussionLessons) {
			assert.ok(lesson.tags.includes("discussion"), "should have discussion tag");
			// Verify metadata fields
			assert.ok(lesson.metadata, "discussion lesson should have metadata");
			assert.ok(typeof lesson.metadata.comment_id === "number", "should have comment_id");
			assert.ok(lesson.metadata.html_url, "should have html_url");
			assert.ok(lesson.metadata.created_at, "should have created_at");
			// Issue-style comments should NOT have inline-only fields
			assert.equal(lesson.metadata.diff_hunk, undefined, "should not have diff_hunk");
			assert.equal(lesson.metadata.original_line, undefined, "should not have original_line");
			assert.equal(lesson.metadata.start_line, undefined, "should not have start_line");
			assert.equal(lesson.metadata.position, undefined, "should not have position");
			assert.equal(lesson.metadata.side, undefined, "should not have side");
		}
	});

	// ── Bot filtering ─────────────────────────────────────────────────

	it("excludes bot comments by default (--include-bots false)", async () => {
		const { stats } = await ingestAndList(BOT_COMMENTS, { includeBots: false });
		// Bots should be filtered: codeql, codex, cursor, dependabot, github-actions = 5 bot items
		assert.ok(stats.lessons_skipped_bot >= 5, "should skip at least 5 bot comments");
		// Only human-authored content should produce lessons
		assert.ok(stats.lessons_added >= 1, "should add at least 1 human-authored lesson");
	});

	it("includes bot comments when --include-bots true", async () => {
		const { stats } = await ingestAndList(BOT_COMMENTS, { includeBots: true });
		assert.equal(stats.lessons_skipped_bot, 0, "should skip zero bot comments");
		// With bots included, all 7 items (2 reviews + 3 inline + 2 issue) produce lessons
		// The stub may produce 1-2 per source, so just check it's larger
		const totalLessons =
			stats.pr_review_overall +
			stats.pr_review_inline +
			stats.pr_review_reply +
			stats.pr_discussion;
		assert.ok(
			totalLessons >= 7,
			`should produce at least 7 total lessons across all surfaces, got ${totalLessons}`,
		);
	});

	// ── Idempotency ───────────────────────────────────────────────────

	it("re-run produces zero new lessons (idempotent on content hash)", async () => {
		const memoryDir = makeTmpDir();
		const client = createFixtureClient(SINGLE_OVERALL_REVIEW);

		// First run
		const result1 = await ingestPrReviews(
			{
				owner: "acme",
				repo: "widgets",
				memoryDir,
				quality: "default",
				dryRun: false,
				includeBots: false,
				since: undefined,
				maxPrs: undefined,
			},
			client,
		);
		const firstAdded = result1.stats.lessons_added;
		assert.ok(firstAdded >= 1, "first run should add at least 1 lesson");

		// Second run (same fixture, same memory dir)
		const result2 = await ingestPrReviews(
			{
				owner: "acme",
				repo: "widgets",
				memoryDir,
				quality: "default",
				dryRun: false,
				includeBots: false,
				since: undefined,
				maxPrs: undefined,
			},
			client,
		);
		// The second run skips via cursor (PR 1 already ingested)
		assert.equal(result2.stats.prs_scanned, 0, "second run should scan 0 PRs (cursor-based skip)");
		assert.equal(result2.stats.lessons_added, 0, "second run should add 0 lessons");

		// Verify total lesson count is unchanged
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: memoryDir,
			owner: "acme",
			repo: "widgets",
		});
		const list = await adapter.listLessons({ limit: 1000 });
		assert.equal(list.items.length, firstAdded, "total lesson count should be unchanged");
		await adapter.shutdown();
	});

	// ── --since cutoff ────────────────────────────────────────────────

	it("--since cutoff excludes older PRs", async () => {
		const { stats } = await ingestAndList(SINCE_CUTOFF, {
			since: new Date("2026-02-01"),
		});
		assert.equal(stats.prs_skipped_since, 1, "should skip 1 PR (January)");
		assert.equal(stats.prs_scanned, 2, "should scan 2 PRs (Feb + Mar)");
		assert.equal(stats.pr_review_overall, 2, "should produce 2 overall review lessons");
	});

	// ── --max-prs limit ───────────────────────────────────────────────

	it("--max-prs limits PR count", async () => {
		const { stats } = await ingestAndList(MANY_PRS, { maxPrs: 3 });
		assert.equal(stats.prs_scanned, 3, "should scan exactly 3 PRs");
		assert.equal(stats.pr_review_overall, 3, "should produce 3 overall review lessons");
	});

	// ── --dry-run ─────────────────────────────────────────────────────

	it("--dry-run prints stats without writing", async () => {
		const memoryDir = makeTmpDir();
		const client = createFixtureClient(SINGLE_OVERALL_REVIEW);
		const result = await ingestPrReviews(
			{
				owner: "acme",
				repo: "widgets",
				memoryDir,
				quality: "default",
				dryRun: true,
				includeBots: false,
				since: undefined,
				maxPrs: undefined,
			},
			client,
		);
		assert.equal(result.exitCode, 0);
		assert.ok(result.stdout.includes("[dry-run]"), "stdout should indicate dry-run");
		assert.ok(result.stdout.includes("Would ingest"), "stdout should show would-ingest count");

		// Verify memory dir has no lessons
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: memoryDir,
			owner: "acme",
			repo: "widgets",
		});
		const list = await adapter.listLessons({ limit: 1000 });
		assert.equal(list.items.length, 0, "dry-run should not write lessons");
		await adapter.shutdown();
	});

	// ── Stats breakdown ───────────────────────────────────────────────

	it("stats show breakdown by source_kind", async () => {
		const MIXED_SURFACES: FixtureData = {
			prs: [
				{
					number: 10,
					title: "Mixed",
					state: "closed",
					merged: true,
					merged_at: "2026-04-10T10:00:00Z",
					html_url: "https://github.com/acme/widgets/pull/10",
					user: { login: "alice" },
					created_at: "2026-04-09T08:00:00Z",
					updated_at: "2026-04-10T10:00:00Z",
				},
			],
			reviews: {
				"10": [
					{
						id: 10001,
						state: "CHANGES_REQUESTED",
						body: "Issues found.",
						user: { login: "bob" },
						submitted_at: "2026-04-10T09:00:00Z",
						html_url: "https://github.com/acme/widgets/pull/10#pullrequestreview-10001",
					},
				],
			},
			reviewComments: {
				"10": [
					{
						id: 10010,
						path: "src/storage.ts",
						original_line: 50,
						line: 50,
						original_start_line: null,
						start_line: null,
						diff_hunk: "@@ -48,3 +48,4 @@\n+  write",
						commit_id: "c0d0e0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0",
						position: 2,
						original_position: 2,
						side: "RIGHT",
						start_side: null,
						pull_request_review_id: 10001,
						in_reply_to_id: null,
						user: { login: "bob" },
						created_at: "2026-04-10T09:10:00Z",
						updated_at: "2026-04-10T09:10:00Z",
						html_url: "https://github.com/acme/widgets/pull/10#discussion_r10010",
						body: "Use atomic write.",
					},
					{
						id: 10012,
						path: "src/storage.ts",
						original_line: 57,
						line: 57,
						original_start_line: null,
						start_line: null,
						diff_hunk: "@@ -53,3 +53,5 @@\n+  done",
						commit_id: "c0d0e0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0",
						position: 4,
						original_position: 4,
						side: "RIGHT",
						start_side: null,
						pull_request_review_id: 10001,
						in_reply_to_id: 10010,
						user: { login: "alice" },
						created_at: "2026-04-10T09:30:00Z",
						updated_at: "2026-04-10T09:30:00Z",
						html_url: "https://github.com/acme/widgets/pull/10#discussion_r10012",
						body: "Done!",
					},
				],
			},
			issueComments: {
				"10": [
					{
						id: 10020,
						body: "Much better.",
						user: { login: "charlie" },
						created_at: "2026-04-10T09:45:00Z",
						updated_at: "2026-04-10T09:45:00Z",
						html_url: "https://github.com/acme/widgets/issues/10#issuecomment-10020",
					},
				],
			},
		};

		const { stats, stdout } = await ingestAndList(MIXED_SURFACES);
		assert.ok(stats.pr_review_overall >= 1, "should have at least 1 overall review");
		assert.ok(stats.pr_review_inline >= 1, "should have at least 1 inline comment");
		assert.ok(stats.pr_review_reply >= 1, "should have at least 1 reply");
		assert.ok(stats.pr_discussion >= 1, "should have at least 1 discussion");
		assert.ok(stdout.includes("pr_review_overall:"), "stdout should show overall count");
		assert.ok(stdout.includes("pr_review_inline:"), "stdout should show inline count");
		assert.ok(stdout.includes("pr_review_reply:"), "stdout should show reply count");
		assert.ok(stdout.includes("pr_discussion:"), "stdout should show discussion count");
	});

	// ── Current (non-outdated) inline comment ──────────────────────────

	it("non-outdated comment is tagged as current", async () => {
		const { lessons } = await ingestAndList(SINGLE_INLINE_COMMENT);
		const inlineLesson = lessons.find((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLesson, "should have an inline lesson");
		assert.ok(inlineLesson.tags.includes("current"), "should be tagged current");
		assert.ok(!inlineLesson.tags.includes("outdated"), "should NOT be tagged outdated");
	});

	// ── Original inline comment has no reply tag ───────────────────────

	it("original inline comment is not tagged as reply", async () => {
		const { lessons } = await ingestAndList(INLINE_WITH_REPLY);
		const inlineLessons = lessons.filter((l) => l.source_kind === "pr_review_inline");
		assert.ok(inlineLessons.length >= 1, "should have at least 1 inline lesson");
		for (const lesson of inlineLessons) {
			assert.ok(!lesson.tags.includes("reply"), "original inline should not have reply tag");
		}
	});

	// ── Dedup key is comment_id for review-comment surfaces ────────────

	it("dedup key is comment_id (same body different comment_id = different lessons)", async () => {
		// Create a fixture with two PRs that have comments with the same body but different IDs
		const SAME_BODY: FixtureData = {
			prs: [
				{
					number: 40,
					title: "PR A",
					state: "closed",
					merged: true,
					merged_at: "2026-04-01T10:00:00Z",
					html_url: "https://github.com/acme/widgets/pull/40",
					user: { login: "alice" },
					created_at: "2026-03-31T08:00:00Z",
					updated_at: "2026-04-01T10:00:00Z",
				},
				{
					number: 41,
					title: "PR B",
					state: "closed",
					merged: true,
					merged_at: "2026-04-02T10:00:00Z",
					html_url: "https://github.com/acme/widgets/pull/41",
					user: { login: "alice" },
					created_at: "2026-04-01T08:00:00Z",
					updated_at: "2026-04-02T10:00:00Z",
				},
			],
			reviews: { "40": [], "41": [] },
			reviewComments: {
				"40": [
					{
						id: 40001,
						path: "src/a.ts",
						original_line: 10,
						line: 10,
						original_start_line: null,
						start_line: null,
						diff_hunk: "@@ -8,3 +8,4 @@\n+  same body text",
						commit_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						position: 1,
						original_position: 1,
						side: "RIGHT",
						start_side: null,
						pull_request_review_id: null,
						in_reply_to_id: null,
						user: { login: "bob" },
						created_at: "2026-04-01T09:00:00Z",
						updated_at: "2026-04-01T09:00:00Z",
						html_url: "https://github.com/acme/widgets/pull/40#discussion_r40001",
						body: "Same body text",
					},
				],
				"41": [
					{
						id: 41001,
						path: "src/b.ts",
						original_line: 20,
						line: 20,
						original_start_line: null,
						start_line: null,
						diff_hunk: "@@ -18,3 +18,4 @@\n+  same body text",
						commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
						position: 1,
						original_position: 1,
						side: "RIGHT",
						start_side: null,
						pull_request_review_id: null,
						in_reply_to_id: null,
						user: { login: "bob" },
						created_at: "2026-04-02T09:00:00Z",
						updated_at: "2026-04-02T09:00:00Z",
						html_url: "https://github.com/acme/widgets/pull/41#discussion_r41001",
						body: "Same body text",
					},
				],
			},
			issueComments: { "40": [], "41": [] },
		};

		const { lessons } = await ingestAndList(SAME_BODY);
		const inlineLessons = lessons.filter((l) => l.source_kind === "pr_review_inline");
		assert.ok(
			inlineLessons.length >= 2,
			"should produce at least 2 inline lessons (dedup by comment_id, not body)",
		);
	});
});
