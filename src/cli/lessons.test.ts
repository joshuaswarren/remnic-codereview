// Lessons read commands tests — TDD red phase.
// Tests: list on empty memory dir renders empty-state message; list --json returns valid JSON;
// list --filter severity=high filters correctly; list --filter source_kind=X filters correctly;
// list --sort date orders by original_incident_date descending; list --limit/cursor pagination;
// list --filter tags=X; list --filter still_applies=true; show renders full detail;
// show nonexistent id exits non-zero with 'not found'; invalid filter value exits non-zero
// with valid options listed.

import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Lesson } from "../schemas/lesson.js";
import { runLessonsList, runLessonsShow } from "./lessons.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for a test and return its path. */
function tmpDir(prefix = "remnic-lessons-test-"): string {
	return mkdtempSync(join(os.tmpdir(), prefix));
}

/** Build a valid Lesson fixture with optional overrides. */
function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
	return {
		id: `les_test_${Math.random().toString(36).slice(2, 10)}`,
		summary: "Test lesson summary",
		severity: "high",
		source_kind: "rules_doc",
		source_url: "https://example.com/CLAUDE.md",
		original_incident_date: "2026-04-15T00:00:00Z",
		still_applies: true,
		tags: ["security", "testing"],
		pattern_keywords: ["guard", "slice"],
		what_to_check: "Check that slice guards are present",
		suggested_fix_template: "Add if (n <= 0) return",
		...overrides,
	};
}

/** Seed a memory dir with lesson fixtures. Returns the lessons stored. */
function seedLessons(memoryDir: string, lessons: Lesson[]): void {
	const lessonsDir = join(memoryDir, "lessons");
	mkdirSync(lessonsDir, { recursive: true });
	for (const lesson of lessons) {
		const stored = {
			lesson,
			stored_at: new Date().toISOString(),
			content_hash: "fake_hash",
		};
		writeFileSync(join(lessonsDir, `${lesson.id}.json`), JSON.stringify(stored, null, 2), "utf-8");
	}
	// Create reviews dir too
	mkdirSync(join(memoryDir, "reviews"), { recursive: true });
}

/** Capture stdout during an async callback. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const origWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk: unknown) => {
		if (typeof chunk === "string") chunks.push(chunk);
		return true;
	};
	try {
		await fn();
	} finally {
		process.stdout.write = origWrite;
	}
	return chunks.join("");
}

/** Capture stderr during an async callback. */
async function _captureStderr(fn: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const origWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = (chunk: unknown) => {
		if (typeof chunk === "string") chunks.push(chunk);
		return true;
	};
	try {
		await fn();
	} finally {
		process.stderr.write = origWrite;
	}
	return chunks.join("");
}

// Track temp dirs to clean up
const tempDirs: string[] = [];

afterEach(() => {
	for (const d of tempDirs) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
	tempDirs.length = 0;
});

// ── List Tests ───────────────────────────────────────────────────────────────

describe("lessons list command", () => {
	it("renders empty-state message on empty memory dir", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		mkdirSync(join(mem, "lessons"), { recursive: true });
		mkdirSync(join(mem, "reviews"), { recursive: true });

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: false });
		});

		assert.match(output, /no lessons found/i);
	});

	it("renders empty-state JSON on empty memory dir with --json", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		mkdirSync(join(mem, "lessons"), { recursive: true });
		mkdirSync(join(mem, "reviews"), { recursive: true });

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true });
		});

		const parsed = JSON.parse(output) as { items: unknown[]; total: number };
		assert.equal(parsed.items.length, 0);
		assert.equal(parsed.total, 0);
	});

	it("returns valid JSON array with --json", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_001", summary: "Lesson one", severity: "high" }),
			makeLesson({ id: "les_002", summary: "Lesson two", severity: "low" }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.ok(Array.isArray(parsed.items));
		assert.equal(parsed.items.length, 2);
		assert.equal(parsed.total, 2);

		// Check each item has required fields
		for (const item of parsed.items) {
			assert.ok(item.id, "item has id");
			assert.ok(item.summary, "item has summary");
			assert.ok(item.severity, "item has severity");
			assert.ok(item.source_kind, "item has source_kind");
			assert.ok(item.source_url, "item has source_url");
			assert.ok(Array.isArray(item.tags), "item has tags array");
			assert.ok(item.original_incident_date, "item has original_incident_date");
			assert.equal(typeof item.still_applies, "boolean", "item has still_applies boolean");
		}
	});

	it("renders a table by default (not JSON)", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lesson = makeLesson({ id: "les_001", summary: "My test lesson" });
		seedLessons(mem, [lesson]);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: false });
		});

		// Should contain column headers
		assert.match(output, /ID/i);
		assert.match(output, /SEVERITY/i);
		assert.match(output, /SUMMARY/i);
		// First non-whitespace char should NOT be { or [
		const trimmed = output.trimStart();
		assert.ok(!trimmed.startsWith("{") && !trimmed.startsWith("["), "Not raw JSON");
		// Should contain the lesson id
		assert.match(output, /les_001/);
	});

	it("filters by severity=high with --filter", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_high", severity: "high" }),
			makeLesson({ id: "les_low", severity: "low" }),
			makeLesson({ id: "les_crit", severity: "critical" }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, filter: { severity: "high" } });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 1);
		assert.equal(parsed.items[0]?.severity, "high");
	});

	it("filters by source_kind=rules_doc with --filter", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_rules", source_kind: "rules_doc" }),
			makeLesson({
				id: "les_inline",
				source_kind: "pr_review_inline",
				source_url: "https://github.com/test/repo/pull/1#discussion_r1",
			}),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, filter: { source_kind: "rules_doc" } });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 1);
		assert.equal(parsed.items[0]?.source_kind, "rules_doc");
	});

	it("filters by tags with --filter tags=X", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_sec", tags: ["security", "auth"] }),
			makeLesson({ id: "les_perf", tags: ["performance"] }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, filter: { tags: "security" } });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 1);
		assert.equal(parsed.items[0]?.id, "les_sec");
	});

	it("filters by still_applies=true with --filter", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_applies", still_applies: true }),
			makeLesson({ id: "les_not_applies", still_applies: false }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, filter: { still_applies: "true" } });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 1);
		assert.equal(parsed.items[0]?.id, "les_applies");
		assert.equal(parsed.items[0]?.still_applies, true);
	});

	it("sorts by original_incident_date descending by default", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_old", original_incident_date: "2026-01-01T00:00:00Z" }),
			makeLesson({ id: "les_new", original_incident_date: "2026-06-15T00:00:00Z" }),
			makeLesson({ id: "les_mid", original_incident_date: "2026-03-10T00:00:00Z" }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({
				memoryDir: mem,
				json: true,
				sort: "original_incident_date",
			});
		});

		const parsed = JSON.parse(output) as { items: Lesson[] };
		assert.equal(parsed.items.length, 3);
		// Descending order: newest first
		assert.equal(parsed.items[0]?.id, "les_new");
		assert.equal(parsed.items[1]?.id, "les_mid");
		assert.equal(parsed.items[2]?.id, "les_old");
	});

	it("sorts by original_incident_date ascending with :asc suffix", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_old", original_incident_date: "2026-01-01T00:00:00Z" }),
			makeLesson({ id: "les_new", original_incident_date: "2026-06-15T00:00:00Z" }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({
				memoryDir: mem,
				json: true,
				sort: "original_incident_date:asc",
			});
		});

		const parsed = JSON.parse(output) as { items: Lesson[] };
		assert.equal(parsed.items[0]?.id, "les_old");
		assert.equal(parsed.items[1]?.id, "les_new");
	});

	it("respects --limit for pagination", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_001", original_incident_date: "2026-04-01T00:00:00Z" }),
			makeLesson({ id: "les_002", original_incident_date: "2026-04-02T00:00:00Z" }),
			makeLesson({ id: "les_003", original_incident_date: "2026-04-03T00:00:00Z" }),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, limit: 2 });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number; cursor?: string };
		assert.equal(parsed.items.length, 2);
		assert.ok(parsed.cursor, "Should have a cursor for next page");
	});

	it("respects --cursor for pagination with no overlap", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_001", original_incident_date: "2026-04-01T00:00:00Z" }),
			makeLesson({ id: "les_002", original_incident_date: "2026-04-02T00:00:00Z" }),
			makeLesson({ id: "les_003", original_incident_date: "2026-04-03T00:00:00Z" }),
		];
		seedLessons(mem, lessons);

		// First page
		const output1 = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, limit: 2 });
		});
		const page1 = JSON.parse(output1) as { items: Lesson[]; total: number; cursor?: string };
		const page1Ids = new Set(page1.items.map((l) => l.id));

		assert.ok(page1.cursor, "First page should have a cursor");

		// Second page
		const output2 = await captureStdout(async () => {
			const opts: { memoryDir: string; json: boolean; limit: number; cursor?: string } = {
				memoryDir: mem,
				json: true,
				limit: 2,
			};
			if (page1.cursor) opts.cursor = page1.cursor;
			await runLessonsList(opts);
		});
		const page2 = JSON.parse(output2) as { items: Lesson[]; total: number; cursor?: string };
		const page2Ids = new Set(page2.items.map((l) => l.id));

		// No overlap between pages
		for (const id of page2Ids) {
			assert.equal(page1Ids.has(id), false, `ID ${id} should not appear on both pages`);
		}
	});

	it("AND-combines multiple filters", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({
				id: "les_high_sec",
				severity: "high",
				tags: ["security"],
			}),
			makeLesson({
				id: "les_low_sec",
				severity: "low",
				tags: ["security"],
			}),
			makeLesson({
				id: "les_high_perf",
				severity: "high",
				tags: ["performance"],
			}),
		];
		seedLessons(mem, lessons);

		const output = await captureStdout(async () => {
			await runLessonsList({
				memoryDir: mem,
				json: true,
				filter: { severity: "high", tags: "security" },
			});
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 1);
		assert.equal(parsed.items[0]?.id, "les_high_sec");
	});

	it("returns empty items for filter matching nothing", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		seedLessons(mem, [makeLesson({ severity: "high" })]);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, filter: { severity: "info" } });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number };
		assert.equal(parsed.items.length, 0);
		assert.equal(parsed.total, 0);
	});
});

// ── Show Tests ───────────────────────────────────────────────────────────────

describe("lessons show command", () => {
	it("renders full detail for a valid lesson id", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lesson = makeLesson({
			id: "les_abc123",
			summary: "Always guard against zero in slice(-n)",
			severity: "critical",
			source_kind: "rules_doc",
			source_url: "https://github.com/example/repo/blob/main/CLAUDE.md",
			original_incident_date: "2026-04-15T12:00:00Z",
			still_applies: true,
			tags: ["security", "arrays"],
			pattern_keywords: ["slice", "guard"],
			what_to_check: "Check that n > 0 before calling slice(-n)",
			suggested_fix_template: "if (n <= 0) return [];",
		});
		seedLessons(mem, [lesson]);

		const output = await captureStdout(async () => {
			await runLessonsShow({ memoryDir: mem, lessonId: "les_abc123", json: false });
		});

		// Should contain all major fields
		assert.match(output, /les_abc123/);
		assert.match(output, /Always guard against zero in slice\(-n\)/);
		assert.match(output, /critical/);
		assert.match(output, /rules_doc/);
		assert.match(output, /CLAUDE\.md/);
		assert.match(output, /2026-04-15/);
		assert.match(output, /true/i); // still_applies
		assert.match(output, /security/);
		assert.match(output, /slice.*guard/i); // pattern_keywords
		assert.match(output, /Check that n > 0/); // what_to_check
		assert.match(output, /if \(n <= 0\)/); // suggested_fix_template
	});

	it("renders full JSON with --json flag", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lesson = makeLesson({
			id: "les_json_test",
			pattern_keywords: ["test"],
			what_to_check: "Verify JSON output",
			suggested_fix_template: "Add test",
			code_examples: ["const x = 1;"],
		});
		seedLessons(mem, [lesson]);

		const output = await captureStdout(async () => {
			await runLessonsShow({ memoryDir: mem, lessonId: "les_json_test", json: true });
		});

		const parsed = JSON.parse(output) as Lesson;
		assert.equal(parsed.id, "les_json_test");
		assert.ok(parsed.summary);
		assert.ok(parsed.severity);
		assert.ok(parsed.source_kind);
		assert.ok(parsed.source_url);
		assert.ok(parsed.tags);
		assert.ok(parsed.original_incident_date);
		assert.equal(typeof parsed.still_applies, "boolean");
		assert.ok(parsed.pattern_keywords);
		assert.ok(parsed.what_to_check);
		assert.ok(parsed.suggested_fix_template);
		assert.ok(parsed.code_examples);
	});

	it("throws with 'not found' for a nonexistent lesson id", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		mkdirSync(join(mem, "lessons"), { recursive: true });
		mkdirSync(join(mem, "reviews"), { recursive: true });

		await assert.rejects(
			async () => {
				await runLessonsShow({ memoryDir: mem, lessonId: "les_NEVERMINTED999", json: false });
			},
			(err: unknown) => {
				assert.ok(err instanceof Error, "Should throw an Error");
				assert.match(err.message, /not found/i);
				assert.match(err.message, /les_NEVERMINTED999/);
				return true;
			},
		);
	});
});

// ── Validation Contract Tests ────────────────────────────────────────────────

describe("lessons list validation contract", () => {
	it("JSON output includes required fields on every item", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lesson = makeLesson({
			id: "les_contract",
			summary: "Contract test lesson",
			severity: "medium",
			source_kind: "rules_doc",
			source_url: "https://example.com/AGENTS.md",
			original_incident_date: "2026-04-01T00:00:00Z",
			still_applies: false,
			tags: ["testing"],
		});
		seedLessons(mem, [lesson]);

		const output = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true });
		});

		const parsed = JSON.parse(output) as { items: Lesson[]; total: number; cursor?: string };

		// Shape: must have items, total
		assert.ok(Array.isArray(parsed.items));
		assert.equal(typeof parsed.total, "number");
		assert.equal(parsed.total, 1);

		const item = parsed.items[0];
		assert.ok(item);

		// Required fields per VAL-M1-020
		assert.ok("id" in item);
		assert.ok("summary" in item);
		assert.ok("severity" in item);
		assert.ok("source_kind" in item);
		assert.ok("source_url" in item);
		assert.ok("tags" in item);
		assert.ok("original_incident_date" in item);
		assert.ok("still_applies" in item);

		// Severity must be one of the documented values
		const validSeverities = ["critical", "high", "medium", "low", "info"];
		assert.ok(validSeverities.includes(item.severity));
	});

	it("deterministic JSON output across identical consecutive reads", async () => {
		const mem = tmpDir();
		tempDirs.push(mem);
		const lessons = [
			makeLesson({ id: "les_a", original_incident_date: "2026-01-01T00:00:00Z" }),
			makeLesson({ id: "les_b", original_incident_date: "2026-06-01T00:00:00Z" }),
		];
		seedLessons(mem, lessons);

		const output1 = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, sort: "original_incident_date" });
		});
		const output2 = await captureStdout(async () => {
			await runLessonsList({ memoryDir: mem, json: true, sort: "original_incident_date" });
		});

		assert.equal(output1, output2, "Identical reads should produce byte-identical output");
	});
});
