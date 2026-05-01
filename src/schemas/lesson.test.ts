// Tests for the Lesson Zod schema.
// TDD red — these should fail until lesson.ts is implemented.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Lesson schema", () => {
	it("parses a complete fixture with all required fields", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC123",
			summary: "Always guard slice(-n) against n===0",
			severity: "high",
			source_kind: "rules_doc",
			source_url: "https://github.com/example/repo/blob/main/CLAUDE.md",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: ["bug", "safety"],
		};
		const result = LessonSchema.parse(fixture);
		assert.equal(result.id, "les_01HXABC123");
		assert.equal(result.summary, "Always guard slice(-n) against n===0");
		assert.equal(result.severity, "high");
		assert.equal(result.source_kind, "rules_doc");
		assert.equal(result.source_url, "https://github.com/example/repo/blob/main/CLAUDE.md");
		assert.equal(result.still_applies, true);
		assert.deepEqual(result.tags, ["bug", "safety"]);
	});

	it("parses a complete fixture with optional fields", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC456",
			summary: "Use atomic rename for file writes",
			severity: "critical",
			source_kind: "fix_commit",
			source_url: "https://github.com/example/repo/commit/abc123",
			original_incident_date: "2026-03-15T08:30:00Z",
			still_applies: true,
			tags: ["safety", "filesystem"],
			files_touched_glob: ["src/**/*.ts"],
			pattern_keywords: ["rename", "atomic", "temp"],
			what_to_check: "Check that file writes use write-tmp-then-rename pattern",
			suggested_fix_template: "Use writeTmp + rename instead of direct write",
			code_examples: ["writeFileSync(tmp, data); renameSync(tmp, target)"],
			related_lessons: ["les_01HXABC123"],
		};
		const result = LessonSchema.parse(fixture);
		assert.equal(result.files_touched_glob?.[0], "src/**/*.ts");
		assert.equal(result.pattern_keywords?.length, 3);
		assert.equal(result.what_to_check, "Check that file writes use write-tmp-then-rename pattern");
		assert.equal(result.suggested_fix_template, "Use writeTmp + rename instead of direct write");
		assert.deepEqual(result.code_examples, ["writeFileSync(tmp, data); renameSync(tmp, target)"]);
		assert.deepEqual(result.related_lessons, ["les_01HXABC123"]);
	});

	it("rejects missing required field 'id'", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			summary: "Missing id",
			severity: "high",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		assert.throws(() => LessonSchema.parse(fixture), /id/i);
	});

	it("rejects missing required field 'summary'", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC789",
			severity: "high",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		assert.throws(() => LessonSchema.parse(fixture), /summary/i);
	});

	it("rejects missing required field 'severity'", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC789",
			summary: "test",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		assert.throws(() => LessonSchema.parse(fixture), /severity/i);
	});

	it("rejects invalid severity value", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC789",
			summary: "test",
			severity: "urgent",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		assert.throws(() => LessonSchema.parse(fixture));
	});

	it("rejects invalid source_kind value", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC789",
			summary: "test",
			severity: "high",
			source_kind: "invalid_kind",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		assert.throws(() => LessonSchema.parse(fixture));
	});

	it("rejects missing required field 'tags'", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_01HXABC789",
			summary: "test",
			severity: "high",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
		};
		assert.throws(() => LessonSchema.parse(fixture), /tags/i);
	});

	it("accepts all valid severity values", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const severities = ["critical", "high", "medium", "low", "info"] as const;
		for (const severity of severities) {
			const fixture = {
				id: `les_${severity}`,
				summary: `test ${severity}`,
				severity,
				source_kind: "rules_doc",
				source_url: "https://example.com",
				original_incident_date: "2026-04-10T12:00:00Z",
				still_applies: true,
				tags: [],
			};
			const result = LessonSchema.parse(fixture);
			assert.equal(result.severity, severity);
		}
	});

	it("accepts all valid source_kind values", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const kinds = [
			"rules_doc",
			"pr_review_overall",
			"pr_review_inline",
			"pr_review_reply",
			"pr_discussion",
			"changelog",
			"adr",
			"post_mortem",
			"closed_issue",
			"fix_commit",
		] as const;
		for (const source_kind of kinds) {
			const fixture = {
				id: `les_${source_kind}`,
				summary: `test ${source_kind}`,
				severity: "medium",
				source_kind,
				source_url: "https://example.com",
				original_incident_date: "2026-04-10T12:00:00Z",
				still_applies: true,
				tags: [],
			};
			const result = LessonSchema.parse(fixture);
			assert.equal(result.source_kind, source_kind);
		}
	});

	it("accepts empty tags array", async () => {
		const { LessonSchema } = await import("./lesson.js");
		const fixture = {
			id: "les_empty_tags",
			summary: "test",
			severity: "info",
			source_kind: "rules_doc",
			source_url: "https://example.com",
			original_incident_date: "2026-04-10T12:00:00Z",
			still_applies: true,
			tags: [],
		};
		const result = LessonSchema.parse(fixture);
		assert.deepEqual(result.tags, []);
	});

	it("exports the Lesson type and SourceKind enum", async () => {
		const mod = await import("./lesson.js");
		assert.ok(mod.LessonSchema, "LessonSchema is exported");
		assert.ok(mod.SourceKind, "SourceKind is exported");
		assert.ok(mod.Severity, "Severity is exported");
	});
});
