// Memory adapter tests — store→search roundtrip, get, list, shutdown.
// Uses a temp memoryDir for each test to ensure isolation.

import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Lesson } from "../schemas/lesson.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "remnic-mem-test-"));
}

/** Minimal lesson fixture for tests. */
function makeLesson(overrides?: Partial<Lesson>): Lesson {
	return {
		id: `les_test_${Math.random().toString(36).slice(2, 10)}`,
		summary: "Always guard slice(-n) against n===0 before negation",
		severity: "high",
		source_kind: "rules_doc",
		source_url: "https://github.com/example/repo/blob/main/CLAUDE.md#L27",
		original_incident_date: new Date().toISOString(),
		still_applies: true,
		tags: ["patterns", "safety"],
		...overrides,
	};
}

describe("MemoryAdapter", () => {
	let memoryDir: string;

	beforeEach(() => {
		memoryDir = makeTempDir();
	});

	afterEach(() => {
		try {
			rmSync(memoryDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	});

	describe("storeLesson", () => {
		it("writes a lesson and returns {id, deduped: false}", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const lesson = makeLesson();
				const result = await adapter.storeLesson(lesson);
				assert.ok(result.id, "result should have an id");
				assert.equal(result.deduped, false, "first write should not be deduped");
			} finally {
				await adapter.shutdown();
			}
		});

		it("returns {deduped: true} when storing the same lesson twice", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const lesson = makeLesson();
				const first = await adapter.storeLesson(lesson);
				assert.equal(first.deduped, false);

				const second = await adapter.storeLesson(lesson);
				assert.equal(second.deduped, true, "second store of same lesson should be deduped");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("searchLessons", () => {
		it("for the lesson's summary text returns it as a hit", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const lesson = makeLesson({
					summary: "Always guard slice(-n) against n===0 before negation",
				});
				await adapter.storeLesson(lesson);

				const hits = await adapter.searchLessons("slice(-n) zero guard");
				assert.ok(Array.isArray(hits), "searchLessons should return an array");
				assert.ok(hits.length > 0, "should find at least one hit for the stored lesson");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("getLesson", () => {
		it("returns the full lesson by id", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const lesson = makeLesson();
				const stored = await adapter.storeLesson(lesson);

				const retrieved = await adapter.getLesson(stored.id);
				assert.ok(retrieved, "should find the lesson by id");
				// Non-null assertion is safe because we just asserted with assert.ok
				const r = retrieved;
				assert.equal(r.id, stored.id);
				assert.equal(r.summary, lesson.summary);
				assert.equal(r.severity, lesson.severity);
				assert.equal(r.source_kind, lesson.source_kind);
				assert.equal(r.source_url, lesson.source_url);
				assert.equal(r.still_applies, lesson.still_applies);
			} finally {
				await adapter.shutdown();
			}
		});

		it("returns null for a nonexistent id", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const result = await adapter.getLesson("les_nonexistent_999");
				assert.equal(result, null, "should return null for nonexistent id");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("listLessons", () => {
		it("with empty memory dir returns {items: [], cursor: undefined}", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const result = await adapter.listLessons();
				assert.ok(Array.isArray(result.items), "items should be an array");
				assert.equal(result.items.length, 0, "empty memory dir should have 0 items");
				assert.equal(result.cursor, undefined, "cursor should be undefined for empty list");
			} finally {
				await adapter.shutdown();
			}
		});

		it("returns stored lessons", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				await adapter.storeLesson(makeLesson({ id: "les_a", summary: "Lesson A about safety" }));
				await adapter.storeLesson(
					makeLesson({ id: "les_b", summary: "Lesson B about performance", tags: ["perf"] }),
				);

				const result = await adapter.listLessons();
				assert.ok(result.items.length >= 2, "should list at least 2 stored lessons");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("storeReview", () => {
		it("stores a posted review and returns {id}", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const review = {
					id: `rev_${Math.random().toString(36).slice(2, 10)}`,
					owner: "test",
					repo: "repo",
					pr_number: 42,
					posted_at: new Date().toISOString(),
					dry_run: true,
					comments: [
						{
							path: "src/foo.ts",
							line: 10,
							body: "Consider using slice guard",
							citation: {
								lesson_id: "les_test",
								source_kind: "rules_doc",
								source_url: "https://example.com",
								original_date: new Date().toISOString(),
								confidence: 0.9,
							},
						},
					],
				};
				const result = await adapter.storeReview(review);
				assert.ok(result.id, "should return an id for the stored review");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("listReviews", () => {
		it("with empty memory dir returns {items: [], cursor: undefined}", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			try {
				const result = await adapter.listReviews();
				assert.ok(Array.isArray(result.items), "items should be an array");
				assert.equal(result.items.length, 0, "empty memory dir should have 0 reviews");
				assert.equal(result.cursor, undefined, "cursor should be undefined for empty list");
			} finally {
				await adapter.shutdown();
			}
		});
	});

	describe("shutdown", () => {
		it("completes without error", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const adapter = await MemoryAdapter.fromConfig({
				memory_dir: memoryDir,
				owner: "test",
				repo: "repo",
			});
			await adapter.shutdown();
		});
	});

	describe("isolation", () => {
		it("separate memoryDirs do not share lessons", async () => {
			const { MemoryAdapter } = await import("./adapter.js");
			const dirA = makeTempDir();
			const dirB = makeTempDir();
			try {
				const adapterA = await MemoryAdapter.fromConfig({
					memory_dir: dirA,
					owner: "test",
					repo: "repoA",
				});
				const adapterB = await MemoryAdapter.fromConfig({
					memory_dir: dirB,
					owner: "test",
					repo: "repoB",
				});
				try {
					await adapterA.storeLesson(makeLesson({ id: "les_only_in_a" }));

					const listA = await adapterA.listLessons();
					const listB = await adapterB.listLessons();

					assert.ok(listA.items.length > 0, "adapterA should have lessons");
					assert.equal(listB.items.length, 0, "adapterB should have no lessons");
				} finally {
					await adapterA.shutdown();
					await adapterB.shutdown();
				}
			} finally {
				rmSync(dirA, { recursive: true, force: true });
				rmSync(dirB, { recursive: true, force: true });
			}
		});
	});
});
