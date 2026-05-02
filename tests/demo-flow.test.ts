// Demo flow integration tests — validates the dogfood demo pipeline.
// Tests the planted-bug diff against seeded Pattern #27 lessons,
// asserts the review output contains slice(-n) citations.

import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { MemoryAdapter } from "../src/memory/adapter.js";
import { chunkHunks } from "../src/review/chunk-hunks.js";
import { compose } from "../src/review/composer.js";
import { judge } from "../src/review/judge.js";
import { renderReview } from "../src/review/poster.js";
import { recall } from "../src/review/recall.js";
import type { Lesson } from "../src/schemas/lesson.js";

// ── Constants ────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const PLANTED_BUG_DIFF = join(FIXTURES_DIR, "diff-samples", "planted-bug-pattern27.diff");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create the Pattern #27 lesson for testing. */
function makePattern27Lesson(): Lesson {
	return {
		id: "les_pattern27_slice_guard",
		summary: "Guard slice(-n) against n === 0 — Pattern #27",
		severity: "high",
		source_kind: "rules_doc",
		source_url: "https://github.com/joshuaswarren/remnic/blob/main/CLAUDE.md#L204",
		original_incident_date: "2026-01-15T00:00:00Z",
		still_applies: true,
		tags: ["slice", "guard", "pattern-27", "zero-guard", "javascript", "array"],
		pattern_keywords: ["slice(-n)", "slice(-count)", "slice(-perPage)", "n <= 0", "zero-guard"],
		what_to_check: "Check that any use of arr.slice(-n) is guarded against n <= 0",
		suggested_fix_template: "return n > 0 ? items.slice(-n) : [];",
		code_examples: ["const last3 = n > 0 ? arr.slice(-n) : [];"],
	};
}

/** Create a seeded memory adapter in a temp dir. */
async function createSeededAdapter(
	lessons: Lesson[],
): Promise<{ adapter: MemoryAdapter; dir: string }> {
	const dir = join("/tmp", `demo-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: dir,
		owner: "joshuaswarren",
		repo: "remnic",
	});
	for (const lesson of lessons) {
		await adapter.storeLesson(lesson);
	}
	return { adapter, dir };
}

// Track temp dirs for cleanup
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
	tempDirs.length = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("dogfood demo pipeline", () => {
	it("planted-bug diff fixture exists and is non-empty", () => {
		assert.ok(existsSync(PLANTED_BUG_DIFF), `Fixture not found: ${PLANTED_BUG_DIFF}`);
		const content = readFileSync(PLANTED_BUG_DIFF, "utf-8");
		assert.ok(content.length > 0, "Fixture diff is empty");
		assert.ok(content.includes("slice(-"), "Fixture should contain slice(- pattern");
	});

	it("planted-bug diff chunks into at least one hunk", () => {
		const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
		const hunks = chunkHunks(diff);
		assert.ok(hunks.length >= 1, "Expected at least 1 hunk from planted-bug diff");
		// Each hunk should contain a slice reference
		for (const hunk of hunks) {
			assert.ok(
				hunk.hunkText.includes("slice(-"),
				`Hunk at ${hunk.file}:${hunk.startLine} should contain slice(-`,
			);
		}
	});

	it("Pattern #27 lesson is recalled against the planted-bug diff", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const { adapter, dir } = await createSeededAdapter([makePattern27Lesson()]);
		tempDirs.push(dir);

		try {
			const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
			const hunks = chunkHunks(diff);
			assert.ok(hunks.length >= 1);

			let foundRecall = false;
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 10 });
				const pattern27Hit = hits.find((h) => h.lesson.id === "les_pattern27_slice_guard");
				if (pattern27Hit) {
					foundRecall = true;
					break;
				}
			}
			assert.ok(foundRecall, "Pattern #27 lesson should be recalled against planted-bug diff");
		} finally {
			await adapter.shutdown();
			delete process.env.OPENAI_JUDGE_STUB;
		}
	});

	it("full pipeline produces comments citing Pattern #27 with slice(-n)", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const { adapter, dir } = await createSeededAdapter([makePattern27Lesson()]);
		tempDirs.push(dir);

		try {
			const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
			const hunks = chunkHunks(diff);

			const verdictInputs = [];
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 10 });
				for (const hit of hits) {
					const verdict = await judge(hunk, hit.lesson, "gpt-5.4-nano");
					if (verdict.applies) {
						verdictInputs.push({
							file: hunk.file,
							line: hunk.startLine,
							lesson: hit.lesson,
							verdict,
						});
					}
				}
			}

			const comments = compose(verdictInputs, { threshold: 0.6 });
			assert.ok(comments.length >= 1, "Expected at least 1 comment");

			// Check that at least one comment references slice(-n)
			const allBodies = comments.map((c) => c.body).join("\n");
			assert.ok(allBodies.includes("slice(-n)"), "Comments should reference slice(-n)");

			// Check citation blocks
			const citationCount = (allBodies.match(/<oai-mem-citation>/g) ?? []).length;
			assert.ok(citationCount >= 1, "Expected at least 1 citation block");

			// Check that Pattern #27 is cited
			assert.ok(
				allBodies.includes("les_pattern27_slice_guard"),
				"Citation should reference the Pattern #27 lesson ID",
			);

			// Check Pattern #27 appears in the comment body
			assert.ok(allBodies.includes("Pattern #27"), "Comment should reference Pattern #27");
		} finally {
			await adapter.shutdown();
			delete process.env.OPENAI_JUDGE_STUB;
		}
	});

	it("rendered review contains all required elements", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const { adapter, dir } = await createSeededAdapter([makePattern27Lesson()]);
		tempDirs.push(dir);

		try {
			const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
			const hunks = chunkHunks(diff);

			const verdictInputs = [];
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 10 });
				for (const hit of hits) {
					const verdict = await judge(hunk, hit.lesson, "gpt-5.4-nano");
					if (verdict.applies) {
						verdictInputs.push({
							file: hunk.file,
							line: hunk.startLine,
							lesson: hit.lesson,
							verdict,
						});
					}
				}
			}

			const comments = compose(verdictInputs, { threshold: 0.6 });
			const review = {
				id: `rev_demo_${Date.now()}`,
				owner: "joshuaswarren",
				repo: "remnic",
				pr_number: 99999,
				posted_at: new Date().toISOString(),
				dry_run: true,
				comments,
			};

			const rendered = renderReview(review);

			// The rendered review should contain:
			// 1. Target repo reference
			assert.ok(rendered.includes("joshuaswarren/remnic"), "Should reference target repo");
			// 2. Dry-run indicator
			assert.ok(rendered.includes("dry-run"), "Should indicate dry-run mode");
			// 3. Comment count
			assert.ok(rendered.includes(`${comments.length} comment`), "Should show comment count");
			// 4. Citation block with all 5 fields
			assert.ok(rendered.includes('<field name="lesson_id">'), "Should have lesson_id field");
			assert.ok(rendered.includes('<field name="source_kind">'), "Should have source_kind field");
			assert.ok(rendered.includes('<field name="source_url">'), "Should have source_url field");
			assert.ok(
				rendered.includes('<field name="original_date">'),
				"Should have original_date field",
			);
			assert.ok(rendered.includes('<field name="confidence">'), "Should have confidence field");
		} finally {
			await adapter.shutdown();
			delete process.env.OPENAI_JUDGE_STUB;
		}
	});

	it("demo uses joshuaswarren/remnic as the target repo", async () => {
		process.env.OPENAI_JUDGE_STUB = "1";
		const { adapter, dir } = await createSeededAdapter([makePattern27Lesson()]);
		tempDirs.push(dir);

		try {
			const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
			const hunks = chunkHunks(diff);

			const verdictInputs = [];
			for (const hunk of hunks) {
				const hits = await recall(adapter, hunk, { topK: 10 });
				for (const hit of hits) {
					const verdict = await judge(hunk, hit.lesson, "gpt-5.4-nano");
					if (verdict.applies) {
						verdictInputs.push({
							file: hunk.file,
							line: hunk.startLine,
							lesson: hit.lesson,
							verdict,
						});
					}
				}
			}

			const comments = compose(verdictInputs, { threshold: 0.6 });

			// The lesson's source_url points to joshuaswarren/remnic
			for (const comment of comments) {
				assert.ok(
					comment.citation.source_url.includes("joshuaswarren/remnic"),
					"Citation should reference joshuaswarren/remnic repo",
				);
			}
		} finally {
			await adapter.shutdown();
			delete process.env.OPENAI_JUDGE_STUB;
		}
	});
});
