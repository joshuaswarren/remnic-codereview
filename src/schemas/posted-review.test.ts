// Tests for the PostedReview + PostedComment Zod schemas.
// TDD red — these should fail until posted-review.ts is implemented.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("PostedReview schema", () => {
	it("parses a valid PostedReview with comments", async () => {
		const { PostedReviewSchema } = await import("./posted-review.js");
		const review = {
			id: "rev_01HXABC",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: "2026-04-10T12:30:00Z",
			dry_run: false,
			comments: [
				{
					path: "src/index.ts",
					line: 10,
					body: 'Consider using a guard clause.\n\n<oai-mem-citation>\n  <field name="lesson_id">les_01HXABC123</field>\n  <field name="source_kind">rules_doc</field>\n  <field name="source_url">https://github.com/example/repo/blob/main/CLAUDE.md</field>\n  <field name="original_date">2026-04-09T12:34:56Z</field>\n  <field name="confidence">0.78</field>\n</oai-mem-citation>',
					citation: {
						lesson_id: "les_01HXABC123",
						source_kind: "rules_doc",
						source_url: "https://github.com/example/repo/blob/main/CLAUDE.md",
						original_date: "2026-04-09T12:34:56Z",
						confidence: 0.78,
					},
				},
			],
		};
		const result = PostedReviewSchema.parse(review);
		assert.equal(result.id, "rev_01HXABC");
		assert.equal(result.owner, "acme");
		assert.equal(result.repo, "widgets");
		assert.equal(result.pr_number, 42);
		assert.equal(result.dry_run, false);
		assert.equal(result.comments.length, 1);
		assert.equal(result.comments[0]?.path, "src/index.ts");
		assert.equal(result.comments[0]?.line, 10);
		assert.equal(result.comments[0]?.citation.confidence, 0.78);
	});

	it("parses a dry-run PostedReview", async () => {
		const { PostedReviewSchema } = await import("./posted-review.js");
		const review = {
			id: "rev_dry_run",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: "2026-04-10T12:30:00Z",
			dry_run: true,
			comments: [],
		};
		const result = PostedReviewSchema.parse(review);
		assert.equal(result.dry_run, true);
		assert.equal(result.comments.length, 0);
	});

	it("rejects missing required field 'id'", async () => {
		const { PostedReviewSchema } = await import("./posted-review.js");
		const review = {
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: "2026-04-10T12:30:00Z",
			dry_run: false,
			comments: [],
		};
		assert.throws(() => PostedReviewSchema.parse(review));
	});

	it("rejects missing comments array", async () => {
		const { PostedReviewSchema } = await import("./posted-review.js");
		const review = {
			id: "rev_01",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			posted_at: "2026-04-10T12:30:00Z",
			dry_run: false,
		};
		assert.throws(() => PostedReviewSchema.parse(review));
	});
});

describe("PostedComment schema", () => {
	it("parses a valid PostedComment", async () => {
		const { PostedCommentSchema } = await import("./posted-review.js");
		const comment = {
			path: "src/utils.ts",
			line: 42,
			body: "This needs a null check",
			citation: {
				lesson_id: "les_01HX",
				source_kind: "pr_review_inline",
				source_url: "https://github.com/example/repo/pull/1#discussion_r1",
				original_date: "2026-04-09T12:00:00Z",
				confidence: 0.92,
			},
		};
		const result = PostedCommentSchema.parse(comment);
		assert.equal(result.path, "src/utils.ts");
		assert.equal(result.line, 42);
		assert.equal(result.citation.lesson_id, "les_01HX");
		assert.equal(result.citation.source_kind, "pr_review_inline");
		assert.equal(result.citation.confidence, 0.92);
	});

	it("rejects a comment with citation confidence outside [0,1]", async () => {
		const { PostedCommentSchema } = await import("./posted-review.js");
		const comment = {
			path: "src/utils.ts",
			line: 42,
			body: "This needs a null check",
			citation: {
				lesson_id: "les_01HX",
				source_kind: "pr_review_inline",
				source_url: "https://github.com/example/repo/pull/1#discussion_r1",
				original_date: "2026-04-09T12:00:00Z",
				confidence: 1.5,
			},
		};
		assert.throws(() => PostedCommentSchema.parse(comment));
	});

	it("exports both schemas", async () => {
		const mod = await import("./posted-review.js");
		assert.ok(mod.PostedReviewSchema, "PostedReviewSchema is exported");
		assert.ok(mod.PostedCommentSchema, "PostedCommentSchema is exported");
	});
});
