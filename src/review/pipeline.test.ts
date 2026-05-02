// Review pipeline tests — TDD test suite for fetch-diff, chunk-hunks, recall,
// judge, composer, poster. Uses OPENAI_JUDGE_STUB=1 for deterministic mode.

import * as assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import type { GitHubClient } from "../github/client.js";
import { MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import type { PostedComment, PostedReview } from "../schemas/posted-review.js";
import type { ReviewVerdict } from "../schemas/review-verdict.js";
import { chunkHunks, type Hunk } from "./chunk-hunks.js";
import { compose, formatCitationBlock } from "./composer.js";
import { fetchDiff } from "./fetch-diff.js";
import { judge } from "./judge.js";
import { postReview, renderReview } from "./poster.js";
import { recall } from "./recall.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a canned Lesson for testing. */
function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
	return {
		id: "les_01TEST001",
		summary: "Always guard slice(-n) against n===0",
		severity: "high",
		source_kind: "rules_doc",
		source_url: "https://github.com/acme/widgets/pull/1#discussion_r1",
		original_incident_date: "2026-01-15T00:00:00Z",
		still_applies: true,
		tags: ["slice", "guard", "pattern-27"],
		pattern_keywords: ["slice(-n)", "zero-guard"],
		what_to_check: "Check that slice(-n) is guarded against n <= 0",
		suggested_fix_template: "return n > 0 ? items.slice(-n) : [];",
		...overrides,
	};
}

/** Create a mock GitHubClient. */
function mockGitHubClient(diff: string): GitHubClient {
	return {
		listPRs: mock.fn(() => Promise.resolve([])),
		getDiff: mock.fn(() => Promise.resolve(diff)),
		listReviews: mock.fn(() => Promise.resolve([])),
		listReviewComments: mock.fn(() => Promise.resolve([])),
		listIssueComments: mock.fn(() => Promise.resolve([])),
		listClosedIssues: mock.fn(() => Promise.resolve([])),
		postReview: mock.fn(() =>
			Promise.resolve({
				id: 1,
				html_url: "https://github.com/acme/widgets/pull/1#review-1",
				state: "COMMENTED",
			}),
		),
	};
}

/** Create a seeded MemoryAdapter in a temp dir. */
async function seededMemoryAdapter(
	lessons: Lesson[],
): Promise<{ adapter: MemoryAdapter; dir: string }> {
	const dir = join("/tmp", `review-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: dir,
		owner: "acme",
		repo: "widgets",
	});
	for (const lesson of lessons) {
		await adapter.storeLesson(lesson);
	}
	return { adapter, dir };
}

// ── chunk-hunks tests ────────────────────────────────────────────────────────

describe("chunk-hunks", () => {
	it("parses a single-hunk diff into one Hunk", () => {
		const diff = `diff --git a/src/storage.ts b/src/storage.ts
index 3a4b5c6..7d8e9f0 100644
--- a/src/storage.ts
+++ b/src/storage.ts
@@ -15,6 +15,8 @@ export class Storage {
   }
 
   async getRecent(n: number): Promise<Item[]> {
-    return this.items.slice(-n);
+    const result = this.items.slice(-n);
+    return result;
   }
 }`;
		const hunks = chunkHunks(diff);
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.file, "src/storage.ts");
		assert.equal(hunks[0]?.startLine, 15);
		assert.equal(hunks[0]?.language, "ts");
		assert.ok(hunks[0]?.hunkText.includes("slice(-n)"));
	});

	it("parses a multi-hunk diff into multiple Hunks", () => {
		const diff = `diff --git a/src/storage.ts b/src/storage.ts
index 3a4b5c6..7d8e9f0 100644
--- a/src/storage.ts
+++ b/src/storage.ts
@@ -15,6 +15,8 @@ export class Storage {
-    return this.items.slice(-n);
+    const result = this.items.slice(-n);
diff --git a/src/utils.ts b/src/utils.ts
index abcdef1..1234567 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,6 +10,10 @@ export function helper(x: string): void {
+export function newHelper(y: string): void {`;
		const hunks = chunkHunks(diff);
		assert.equal(hunks.length, 2);
		assert.equal(hunks[0]?.file, "src/storage.ts");
		assert.equal(hunks[1]?.file, "src/utils.ts");
	});

	it("skips binary diffs", () => {
		const diff = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/assets/logo.png differ`;
		const hunks = chunkHunks(diff);
		assert.equal(hunks.length, 0);
	});

	it("handles renamed files — uses new path", () => {
		const diff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 80%
rename from src/old-name.ts
rename to src/new-name.ts
index 3a4b5c6..7d8e9f0 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -5,7 +5,7 @@ export function processItems(items: Item[]): Item[] {
-  return items.slice(-n);
+  return n > 0 ? items.slice(-n) : [];`;
		const hunks = chunkHunks(diff);
		assert.equal(hunks.length, 1);
		assert.equal(hunks[0]?.file, "src/new-name.ts");
	});

	it("infers language from file extension", () => {
		const pyDiff = `diff --git a/main.py b/main.py
--- a/main.py
+++ b/main.py
@@ -1,3 +1,4 @@
 def hello():
-    pass
+    print("hi")`;
		const hunks = chunkHunks(pyDiff);
		assert.equal(hunks[0]?.language, "py");
	});

	it("returns empty array for empty diff", () => {
		const hunks = chunkHunks("");
		assert.equal(hunks.length, 0);
	});

	it("handles diff with no hunks (just file header)", () => {
		const diff = `diff --git a/README.md b/README.md
index abcdef1..1234567 100644
--- a/README.md
+++ b/README.md`;
		const hunks = chunkHunks(diff);
		assert.equal(hunks.length, 0);
	});
});

// ── recall tests ─────────────────────────────────────────────────────────────

describe("recall", () => {
	it("returns hits from memory adapter for hunk text", async () => {
		const lesson = makeLesson();
		const { adapter, dir } = await seededMemoryAdapter([lesson]);
		try {
			const hunk: Hunk = {
				file: "src/storage.ts",
				startLine: 17,
				endLine: 20,
				language: "ts",
				hunkText: "return this.items.slice(-n);",
				surroundingContext: "getRecent",
			};
			const hits = await recall(adapter, hunk, { topK: 5 });
			assert.ok(hits.length >= 1);
			assert.equal(hits[0]?.lesson.id, lesson.id);
		} finally {
			await adapter.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns empty array when memory is empty", async () => {
		const { adapter, dir } = await seededMemoryAdapter([]);
		try {
			const hunk: Hunk = {
				file: "src/storage.ts",
				startLine: 17,
				endLine: 20,
				language: "ts",
				hunkText: "return this.items.slice(-n);",
				surroundingContext: "",
			};
			const hits = await recall(adapter, hunk, { topK: 5 });
			assert.equal(hits.length, 0);
		} finally {
			await adapter.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("respects topK limit", async () => {
		const lessons = [
			makeLesson({ id: "les_a", summary: "slice guard A", tags: ["slice"] }),
			makeLesson({ id: "les_b", summary: "slice guard B", tags: ["slice"] }),
			makeLesson({ id: "les_c", summary: "slice guard C", tags: ["slice"] }),
		];
		const { adapter, dir } = await seededMemoryAdapter(lessons);
		try {
			const hunk: Hunk = {
				file: "src/storage.ts",
				startLine: 17,
				endLine: 20,
				language: "ts",
				hunkText: "items slice guard",
				surroundingContext: "",
			};
			const hits = await recall(adapter, hunk, { topK: 2 });
			assert.ok(hits.length <= 2);
		} finally {
			await adapter.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── judge tests ──────────────────────────────────────────────────────────────

describe("judge", () => {
	it("returns structured verdict when OPENAI_JUDGE_STUB=1", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const hunk: Hunk = {
			file: "src/storage.ts",
			startLine: 17,
			endLine: 20,
			language: "ts",
			hunkText: "return this.items.slice(-n);",
			surroundingContext: "",
		};
		const lesson = makeLesson();
		const verdict = await judge(hunk, lesson, "gpt-5.4-nano");
		assert.equal(typeof verdict.applies, "boolean");
		assert.equal(typeof verdict.confidence, "number");
		assert.ok(verdict.confidence >= 0 && verdict.confidence <= 1);
		delete process.env.OPENAI_JUDGE_STUB;
	});

	it("stub returns applies=true when hunk text matches lesson keywords", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const hunk: Hunk = {
			file: "src/storage.ts",
			startLine: 17,
			endLine: 20,
			language: "ts",
			hunkText: "return this.items.slice(-n);",
			surroundingContext: "",
		};
		const lesson = makeLesson();
		const verdict = await judge(hunk, lesson, "gpt-5.4-nano");
		assert.equal(verdict.applies, true);
		assert.ok(verdict.confidence >= 0.6);
		delete process.env.OPENAI_JUDGE_STUB;
	});

	it("stub returns applies=false for unrelated hunk", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const hunk: Hunk = {
			file: "src/README.md",
			startLine: 1,
			endLine: 5,
			language: "md",
			hunkText: "# Hello World\nThis is a readme.",
			surroundingContext: "",
		};
		const lesson = makeLesson();
		const verdict = await judge(hunk, lesson, "gpt-5.4-nano");
		assert.equal(verdict.applies, false);
		delete process.env.OPENAI_JUDGE_STUB;
	});
});

// ── composer tests ───────────────────────────────────────────────────────────

describe("composer", () => {
	it("produces exactly one PostedComment from one verdict", () => {
		const lesson = makeLesson();
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.8,
			severity: "high",
			suggested_change: "Add n > 0 guard before slice(-n)",
		};
		const comments = compose([{ file: "src/storage.ts", line: 17, lesson, verdict }]);
		assert.equal(comments.length, 1);
		assert.equal(comments[0]?.path, "src/storage.ts");
		assert.equal(comments[0]?.line, 17);
		assert.ok(comments[0]?.body.includes("slice(-n)"));
	});

	it("citation block has all 5 required fields", () => {
		const lesson = makeLesson();
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.78,
			severity: "high",
			suggested_change: null,
		};
		const comments = compose([{ file: "src/storage.ts", line: 17, lesson, verdict }]);
		const body = comments[0]?.body ?? "";
		assert.ok(body.includes('name="lesson_id"'));
		assert.ok(body.includes('name="source_kind"'));
		assert.ok(body.includes('name="source_url"'));
		assert.ok(body.includes('name="original_date"'));
		assert.ok(body.includes('name="confidence"'));
	});

	it("citation block is the LAST element of the comment body", () => {
		const lesson = makeLesson();
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.8,
			severity: "high",
			suggested_change: null,
		};
		const comments = compose([{ file: "src/storage.ts", line: 17, lesson, verdict }]);
		const body = comments[0]?.body ?? "";
		const lastCitation = body.lastIndexOf("</oai-mem-citation>");
		// No non-whitespace content after the citation
		const afterCitation = body.slice(lastCitation + "</oai-mem-citation>".length).trim();
		assert.equal(afterCitation, "");
	});

	it("deduplicates by (file, line, lesson_id)", () => {
		const lesson = makeLesson();
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.8,
			severity: "high",
			suggested_change: null,
		};
		const comments = compose([
			{ file: "src/storage.ts", line: 17, lesson, verdict },
			{ file: "src/storage.ts", line: 17, lesson, verdict }, // duplicate
		]);
		assert.equal(comments.length, 1);
	});

	it("multiple hunks produce multiple unique comments", () => {
		const lesson1 = makeLesson({ id: "les_001" });
		const lesson2 = makeLesson({ id: "les_002", summary: "Always check null before access" });
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.75,
			severity: "medium",
			suggested_change: null,
		};
		const comments = compose([
			{ file: "src/storage.ts", line: 17, lesson: lesson1, verdict },
			{ file: "src/utils.ts", line: 12, lesson: lesson2, verdict },
		]);
		assert.equal(comments.length, 2);
	});

	it("confidence threshold filters low-confidence verdicts", () => {
		const lesson = makeLesson();
		const comments = compose(
			[
				{
					file: "src/storage.ts",
					line: 17,
					lesson,
					verdict: { applies: true, confidence: 0.4, severity: "low", suggested_change: null },
				},
				{
					file: "src/storage.ts",
					line: 20,
					lesson,
					verdict: { applies: true, confidence: 0.9, severity: "high", suggested_change: null },
				},
			],
			{ threshold: 0.6 },
		);
		assert.equal(comments.length, 1);
		assert.equal(comments[0]?.line, 20);
	});

	it("default threshold is 0.6", () => {
		const lesson = makeLesson();
		const comments = compose(
			[
				{
					file: "src/storage.ts",
					line: 17,
					lesson,
					verdict: { applies: true, confidence: 0.55, severity: "low", suggested_change: null },
				},
			],
			{ threshold: 0.6 },
		);
		assert.equal(comments.length, 0);
	});

	it("empty input produces zero comments", () => {
		const comments = compose([]);
		assert.equal(comments.length, 0);
	});

	it("includes suggested_change in body when present", () => {
		const lesson = makeLesson();
		const verdict: ReviewVerdict = {
			applies: true,
			confidence: 0.8,
			severity: "high",
			suggested_change: "Replace with: return n > 0 ? items.slice(-n) : [];",
		};
		const comments = compose([{ file: "src/storage.ts", line: 17, lesson, verdict }]);
		assert.ok(comments[0]?.body.includes("return n > 0 ? items.slice(-n) : [];"));
	});
});

// ── poster tests ─────────────────────────────────────────────────────────────

describe("poster", () => {
	it("dry-run renders review without calling GitHub postReview", async () => {
		const client = mockGitHubClient("");
		const comments: PostedComment[] = [
			{
				path: "src/storage.ts",
				line: 17,
				body: 'Guard needed.\n<oai-mem-citation>\n<field name="lesson_id">les_01</field>\n</oai-mem-citation>',
				citation: {
					lesson_id: "les_01",
					source_kind: "rules_doc",
					source_url: "https://example.com",
					original_date: "2026-01-15",
					confidence: 0.8,
				},
			},
		];
		const review: PostedReview = {
			id: "rev_01",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: new Date().toISOString(),
			dry_run: true,
			comments,
		};
		const output = renderReview(review);
		assert.ok(output.includes("src/storage.ts"));
		assert.ok(output.includes("les_01"));
		// postReview should NOT have been called (we never called it)
		const postMock = client.postReview as unknown as ReturnType<typeof mock.fn>;
		assert.equal(postMock.mock.calls.length, 0);
	});

	it("non-dry-run calls GitHub postReview", async () => {
		const client = mockGitHubClient("");
		const comments: PostedComment[] = [
			{
				path: "src/storage.ts",
				line: 17,
				body: "Guard needed.",
				citation: {
					lesson_id: "les_01",
					source_kind: "rules_doc",
					source_url: "https://example.com",
					original_date: "2026-01-15",
					confidence: 0.8,
				},
			},
		];
		await postReview(client, "acme", "widgets", 42, comments, false);
		const postMock = client.postReview as unknown as ReturnType<typeof mock.fn>;
		assert.equal(postMock.mock.calls.length, 1);
	});

	it("dry-run does not call GitHub postReview", async () => {
		const client = mockGitHubClient("");
		const comments: PostedComment[] = [];
		await postReview(client, "acme", "widgets", 42, comments, true);
		const postMock = client.postReview as unknown as ReturnType<typeof mock.fn>;
		assert.equal(postMock.mock.calls.length, 0);
	});

	it("rendered review shows comment count", () => {
		const comments: PostedComment[] = [
			{
				path: "src/storage.ts",
				line: 17,
				body: "test",
				citation: {
					lesson_id: "les_01",
					source_kind: "rules_doc",
					source_url: "https://example.com",
					original_date: "2026-01-15",
					confidence: 0.8,
				},
			},
		];
		const review: PostedReview = {
			id: "rev_01",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: new Date().toISOString(),
			dry_run: true,
			comments,
		};
		const output = renderReview(review);
		assert.ok(output.includes("1 comment"));
	});

	it("rendered review shows zero comments when empty", () => {
		const review: PostedReview = {
			id: "rev_02",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: new Date().toISOString(),
			dry_run: true,
			comments: [],
		};
		const output = renderReview(review);
		assert.ok(output.includes("0 comments"));
	});
});

// ── fetch-diff tests ─────────────────────────────────────────────────────────

describe("fetch-diff", () => {
	it("calls GitHub client getDiff with correct args", async () => {
		const client = mockGitHubClient("some diff content");
		const diff = await fetchDiff(client, "acme", "widgets", 42);
		assert.equal(diff, "some diff content");
		const getDiffMock = client.getDiff as unknown as ReturnType<typeof mock.fn>;
		assert.equal(getDiffMock.mock.calls.length, 1);
		const call = getDiffMock.mock.calls[0];
		assert.ok(call !== undefined);
		assert.equal(call.arguments[0], "acme");
		assert.equal(call.arguments[1], "widgets");
		assert.equal(call.arguments[2], 42);
	});

	it("throws on 404 with clear message", async () => {
		const client: GitHubClient = {
			...mockGitHubClient(""),
			getDiff: mock.fn(async () => {
				throw Object.assign(new Error("Not Found"), { status: 404 });
			}),
		};
		await assert.rejects(() => fetchDiff(client, "acme", "missing", 9999), {
			message: /not found|404/i,
		});
	});
});

// ── formatCitationBlock tests ────────────────────────────────────────────────

describe("formatCitationBlock", () => {
	it("produces well-formed XML with all 5 fields", () => {
		const block = formatCitationBlock({
			lesson_id: "les_01HXABC",
			source_kind: "pr_review_inline",
			source_url: "https://github.com/acme/widgets/pull/1#discussion_r1",
			original_date: "2026-04-09T12:34:56Z",
			confidence: 0.78,
		});
		assert.ok(block.startsWith("<oai-mem-citation>"));
		assert.ok(block.endsWith("</oai-mem-citation>"));
		assert.ok(block.includes('<field name="lesson_id">les_01HXABC</field>'));
		assert.ok(block.includes('<field name="source_kind">pr_review_inline</field>'));
		assert.ok(block.includes('<field name="source_url">https://github.com'));
		assert.ok(block.includes('<field name="original_date">2026-04-09'));
		assert.ok(block.includes('<field name="confidence">0.78</field>'));
	});
});

// ── Integration: full pipeline with stubs ────────────────────────────────────

describe("full pipeline integration", () => {
	it("one hunk + one cited lesson produces one PostedComment with citation", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const lesson = makeLesson();
		const { adapter, dir } = await seededMemoryAdapter([lesson]);
		try {
			const diff = `diff --git a/src/storage.ts b/src/storage.ts
--- a/src/storage.ts
+++ b/src/storage.ts
@@ -15,6 +15,8 @@
   async getRecent(n: number): Promise<Item[]> {
-    return this.items.slice(-n);
+    const result = this.items.slice(-n);
+    return result;`;

			// Step 1: chunk
			const hunks = chunkHunks(diff);
			assert.ok(hunks.length >= 1);

			// Step 2: recall
			const allCandidates: Array<{ hunk: Hunk; lesson: Lesson }> = [];
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 5 });
				for (const hit of hits) {
					allCandidates.push({ hunk, lesson: hit.lesson });
				}
			}
			assert.ok(allCandidates.length >= 1);

			// Step 3: judge
			const verdictInputs: Array<{
				file: string;
				line: number;
				lesson: Lesson;
				verdict: ReviewVerdict;
			}> = [];
			for (const { hunk, lesson: cand } of allCandidates) {
				const verdict = await judge(hunk, cand, "gpt-5.4-nano");
				if (verdict.applies) {
					verdictInputs.push({ file: hunk.file, line: hunk.startLine, lesson: cand, verdict });
				}
			}

			// Step 4: compose
			const comments = compose(verdictInputs, { threshold: 0.6 });
			assert.equal(comments.length, 1);
			assert.ok(comments[0]?.body.includes("<oai-mem-citation>"));
			assert.ok(comments[0]?.body.includes(lesson.id));
		} finally {
			await adapter.shutdown();
			rmSync(dir, { recursive: true, force: true });
			delete process.env.OPENAI_JUDGE_STUB;
		}
	});

	it("empty memory store produces zero comments", async () => {
		const { adapter, dir } = await seededMemoryAdapter([]);
		try {
			const diff = `diff --git a/src/storage.ts b/src/storage.ts
--- a/src/storage.ts
+++ b/src/storage.ts
@@ -15,6 +15,8 @@
-    return this.items.slice(-n);
+    const result = this.items.slice(-n);`;
			const hunks = chunkHunks(diff);
			const allCandidates: Array<{ hunk: Hunk; lesson: Lesson }> = [];
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 5 });
				for (const hit of hits) {
					allCandidates.push({ hunk, lesson: hit.lesson });
				}
			}
			assert.equal(allCandidates.length, 0);
			const comments = compose([]);
			assert.equal(comments.length, 0);
		} finally {
			await adapter.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
