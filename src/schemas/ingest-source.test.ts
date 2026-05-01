// Tests for the IngestSource discriminated-union schema.
// TDD red — these should fail until ingest-source.ts is implemented.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("IngestSource schema", () => {
	it("parses a rules_doc source", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "rules_doc",
			repo_path: "/path/to/repo",
			file_path: "CLAUDE.md",
			section_heading: "Pattern #27",
			content: "Always guard slice(-n) against n===0",
		};
		const result = IngestSourceSchema.parse(source);
		assert.equal(result.type, "rules_doc");
		if (result.type === "rules_doc") {
			assert.equal(result.repo_path, "/path/to/repo");
			assert.equal(result.file_path, "CLAUDE.md");
		}
	});

	it("parses a pr_review_overall source", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "pr_review_overall",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			pull_request_review_id: 12345,
			state: "CHANGES_REQUESTED",
			reviewer: "alice",
			body: "Please fix the error handling",
			submitted_at: "2026-04-10T12:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-12345",
		};
		const result = IngestSourceSchema.parse(source);
		assert.equal(result.type, "pr_review_overall");
		if (result.type === "pr_review_overall") {
			assert.equal(result.pr_number, 42);
			assert.equal(result.state, "CHANGES_REQUESTED");
			assert.equal(result.reviewer, "alice");
		}
	});

	it("parses a pr_review_inline source", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "pr_review_inline",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			comment_id: 99999,
			file_path: "src/index.ts",
			original_line: 10,
			line: 10,
			diff_hunk: "@@ -8,3 +8,3 @@\n context\n-old line\n+new line\n",
			commit_id: "abc123def456",
			position: 5,
			side: "RIGHT",
			pull_request_review_id: 12345,
			parent_comment_id: null,
			reviewer: "bob",
			body: "This is wrong",
			created_at: "2026-04-10T12:00:00Z",
			html_url: "https://github.com/acme/widgets/pull/42#discussion_r99999",
		};
		const result = IngestSourceSchema.parse(source);
		assert.equal(result.type, "pr_review_inline");
		if (result.type === "pr_review_inline") {
			assert.equal(result.comment_id, 99999);
			assert.equal(result.file_path, "src/index.ts");
			assert.equal(result.diff_hunk.length > 0, true);
			assert.equal(result.side, "RIGHT");
		}
	});

	it("parses a pr_review_reply source", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "pr_review_reply",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			comment_id: 100000,
			file_path: "src/index.ts",
			diff_hunk: "@@ -8,3 +8,3 @@\n context\n",
			commit_id: "abc123def456",
			parent_comment_id: 99999,
			reviewer: "alice",
			body: "Fixed, thanks!",
			created_at: "2026-04-10T12:05:00Z",
			html_url: "https://github.com/acme/widgets/pull/42#discussion_r100000",
		};
		const result = IngestSourceSchema.parse(source);
		assert.equal(result.type, "pr_review_reply");
		if (result.type === "pr_review_reply") {
			assert.equal(result.parent_comment_id, 99999);
		}
	});

	it("parses a pr_discussion source", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "pr_discussion",
			owner: "acme",
			repo: "widgets",
			pr_number: 42,
			comment_id: 55555,
			commenter: "charlie",
			body: "This PR looks good overall",
			created_at: "2026-04-10T12:10:00Z",
			html_url: "https://github.com/acme/widgets/issues/42#issuecomment-55555",
		};
		const result = IngestSourceSchema.parse(source);
		assert.equal(result.type, "pr_discussion");
		if (result.type === "pr_discussion") {
			assert.equal(result.comment_id, 55555);
			assert.equal(result.commenter, "charlie");
		}
	});

	it("rejects an unknown type value", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "unknown_type",
			body: "something",
		};
		assert.throws(() => IngestSourceSchema.parse(source));
	});

	it("rejects a rules_doc source missing required fields", async () => {
		const { IngestSourceSchema } = await import("./ingest-source.js");
		const source = {
			type: "rules_doc",
			file_path: "CLAUDE.md",
		};
		assert.throws(() => IngestSourceSchema.parse(source));
	});

	it("exports the IngestSourceSchema", async () => {
		const mod = await import("./ingest-source.js");
		assert.ok(mod.IngestSourceSchema, "IngestSourceSchema is exported");
	});
});
