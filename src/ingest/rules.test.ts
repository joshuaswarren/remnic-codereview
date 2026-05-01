// Rules ingestion tests — TDD red phase.
// Tests against the rules ingestion pipeline: walks markdown files, splits by
// headings, extracts lessons, stores via memory adapter, deduplicates, reports stats.

import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { MemoryAdapter } from "../memory/adapter.js";
import type { IngestRulesOptions, IngestRulesResult } from "./rules.js";

// ─── Fixture paths ───────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dirname ?? ".", "../../tests/fixtures/rules-corpus");

/** Canonical file names the rules ingestor walks. */
const CANONICAL_FILES = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "remnic-rules-test-"));
}

function makeConfig(memoryDir: string) {
	return {
		owner: "test",
		repo: "repo",
		memory_dir: memoryDir,
		model_defaults: {
			extraction: "gpt-5.4-mini",
			judge: "gpt-5.4-nano",
			embed: "text-embedding-3-small",
		},
		dry_run: false,
		quality: "default" as const,
	};
}

// Import is dynamic so OPENAI_JUDGE_STUB is read at the right time
async function importRules() {
	return import("./rules.js");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("rules ingestion", () => {
	let tempDir: string;
	let memoryDir: string;

	before(() => {
		// Ensure stub mode
		process.env.OPENAI_JUDGE_STUB = "1";
	});

	beforeEach(() => {
		tempDir = makeTempDir();
		memoryDir = makeTempDir();
	});

	after(() => {
		// Best-effort cleanup
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
		try {
			rmSync(memoryDir, { recursive: true, force: true });
		} catch {}
	});

	it("ingest --rules <fixture> exits 0 and reports N lessons added", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: false,
		};
		const result: IngestRulesResult = await ingestRules(opts);

		assert.equal(result.exitCode, 0);
		assert.ok(result.added >= 1, `Expected at least 1 lesson added, got ${result.added}`);
		assert.equal(result.skipped, 0, "First run should have 0 skipped");
		assert.ok(
			result.stdout.includes("lessons added"),
			`stdout should mention "lessons added": ${result.stdout}`,
		);
	});

	it("lessons have source_kind 'rules_doc'", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: false,
		};
		await ingestRules(opts);

		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons({ source_kind: "rules_doc" });
			assert.ok(items.length >= 1, "Should have at least 1 rules_doc lesson");

			for (const lesson of items) {
				assert.equal(lesson.source_kind, "rules_doc");
			}
		} finally {
			await adapter.shutdown();
		}
	});

	it("re-running same ingest reports '0 new, N skipped' (idempotent)", async () => {
		const { ingestRules } = await importRules();

		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		// First run
		const result1 = await ingestRules(opts);
		assert.equal(result1.exitCode, 0);
		const firstAdded = result1.added;
		assert.ok(firstAdded >= 1);

		// Second run (same args) — sections are skipped by source_hash
		const result2 = await ingestRules(opts);
		assert.equal(result2.exitCode, 0);
		assert.equal(result2.added, 0, "Second run should add 0 lessons");
		assert.ok(result2.skipped >= 1, `Second run should skip >= 1 sections, got ${result2.skipped}`);

		// Verify lesson count is unchanged
		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons();
			assert.equal(items.length, firstAdded, "Total lesson count should be unchanged");
		} finally {
			await adapter.shutdown();
		}
	});

	it("--dry-run prints stats but creates zero lessons in memory dir", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: true,
		};
		const result = await ingestRules(opts);

		assert.equal(result.exitCode, 0);
		assert.ok(result.wouldAdd >= 1, "dry-run should report wouldAdd >= 1");
		assert.ok(
			result.stdout.includes("dry-run") || result.stdout.includes("would"),
			`stdout should mention dry-run or would: ${result.stdout}`,
		);

		// Verify nothing was written
		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons();
			assert.equal(items.length, 0, "dry-run should not create lessons");
		} finally {
			await adapter.shutdown();
		}
	});

	it("--memory-dir <custom> writes to that dir, not the default", async () => {
		const { ingestRules } = await importRules();
		const customDir = makeTempDir();

		try {
			const opts: IngestRulesOptions = {
				rulesPath: FIXTURE_DIR,
				memoryDir: customDir,
				quality: "default",
				dryRun: false,
			};
			const result = await ingestRules(opts);
			assert.equal(result.exitCode, 0);

			const adapter = await MemoryAdapter.fromConfig(makeConfig(customDir));
			try {
				const { items } = await adapter.listLessons();
				assert.ok(items.length >= 1, "Should have lessons in custom dir");
			} finally {
				await adapter.shutdown();
			}
		} finally {
			try {
				rmSync(customDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("stats line includes breakdown by source file", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: false,
		};
		const result = await ingestRules(opts);

		assert.equal(result.exitCode, 0);
		// The result should include per-file breakdown
		assert.ok(result.byFile, "Result should have byFile breakdown");
		// At least CLAUDE.md should be present since the fixture has it
		const files = Object.keys(result.byFile);
		assert.ok(files.length >= 1, "Should have at least 1 source file in breakdown");
	});

	it("walks all three canonical filenames", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "default",
			dryRun: false,
		};
		const result = await ingestRules(opts);

		assert.equal(result.exitCode, 0);
		assert.ok(result.byFile);

		// All three files should be represented in the byFile breakdown
		for (const fileName of CANONICAL_FILES) {
			const found = Object.keys(result.byFile).some((f) => f.includes(fileName));
			assert.ok(
				found,
				`Expected ${fileName} in byFile breakdown: ${Object.keys(result.byFile).join(", ")}`,
			);
		}
	});

	it("rejects a non-existent path", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: "/tmp/definitely-does-not-exist-99999",
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		await assert.rejects(
			() => ingestRules(opts),
			(err: unknown) => {
				assert.ok(
					err instanceof Error &&
						(err.message.includes("not found") ||
							err.message.includes("does not exist") ||
							err.message.includes("ENOENT")),
					`Error message should mention missing path: ${err instanceof Error ? err.message : String(err)}`,
				);
				return true;
			},
		);
	});

	it("rejects a path that is a file, not a directory", async () => {
		const { ingestRules } = await importRules();
		const filePath = join(FIXTURE_DIR, "CLAUDE.md");

		const opts: IngestRulesOptions = {
			rulesPath: filePath,
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		await assert.rejects(
			() => ingestRules(opts),
			(err: unknown) => {
				assert.ok(
					err instanceof Error &&
						(err.message.includes("directory") || err.message.includes("not a directory")),
					`Error message should mention directory: ${err instanceof Error ? err.message : String(err)}`,
				);
				return true;
			},
		);
	});

	it("is robust to a rules dir containing extra unrelated files", async () => {
		// Copy the fixture and add noise files
		const noisyDir = join(tempDir, "noisy-rules");
		mkdirSync(noisyDir, { recursive: true });

		// Copy canonical files
		const { copyFileSync } = await import("node:fs");
		for (const f of CANONICAL_FILES) {
			copyFileSync(join(FIXTURE_DIR, f), join(noisyDir, f));
		}

		// Add noise files
		writeFileSync(join(noisyDir, "README.md"), "# Readme\nJust noise");
		writeFileSync(join(noisyDir, "LICENSE"), "MIT");
		mkdirSync(join(noisyDir, "node_modules", "foo"), { recursive: true });
		writeFileSync(join(noisyDir, "node_modules", "foo", "package.json"), '{"name":"foo"}');
		writeFileSync(join(noisyDir, "image.png"), "not-a-real-png");

		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: noisyDir,
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		const result = await ingestRules(opts);
		assert.equal(result.exitCode, 0);

		// Lessons should only be from canonical files
		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons();
			for (const lesson of items) {
				assert.ok(
					!lesson.source_url.includes("README.md"),
					`Lesson should not reference README.md: ${lesson.source_url}`,
				);
				assert.ok(
					!lesson.source_url.includes("LICENSE"),
					`Lesson should not reference LICENSE: ${lesson.source_url}`,
				);
				assert.ok(
					!lesson.source_url.includes("image.png"),
					`Lesson should not reference image.png: ${lesson.source_url}`,
				);
			}
		} finally {
			await adapter.shutdown();
		}
	});

	it("--memory-dir isolation between two runs", async () => {
		const { ingestRules } = await importRules();

		const memA = makeTempDir();
		const memB = makeTempDir();

		// Empty fixture dir for B
		const emptyDir = join(tempDir, "empty-rules");
		mkdirSync(emptyDir, { recursive: true });

		try {
			// Ingest rules into A
			await ingestRules({
				rulesPath: FIXTURE_DIR,
				memoryDir: memA,
				quality: "default",
				dryRun: false,
			});

			// Ingest empty into B
			await ingestRules({
				rulesPath: emptyDir,
				memoryDir: memB,
				quality: "default",
				dryRun: false,
			});

			const adapterA = await MemoryAdapter.fromConfig(makeConfig(memA));
			const adapterB = await MemoryAdapter.fromConfig(makeConfig(memB));
			try {
				const { items: itemsA } = await adapterA.listLessons();
				const { items: itemsB } = await adapterB.listLessons();

				assert.ok(itemsA.length >= 1, "A should have lessons");
				assert.equal(itemsB.length, 0, "B should be empty");
			} finally {
				await adapterA.shutdown();
				await adapterB.shutdown();
			}
		} finally {
			try {
				rmSync(memA, { recursive: true, force: true });
			} catch {}
			try {
				rmSync(memB, { recursive: true, force: true });
			} catch {}
		}
	});

	it("--quality cheap succeeds and produces stats line", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "cheap",
			dryRun: false,
		};
		const result = await ingestRules(opts);
		assert.equal(result.exitCode, 0);
		assert.ok(result.added >= 1);
	});

	it("--quality high succeeds and produces stats line", async () => {
		const { ingestRules } = await importRules();
		const opts: IngestRulesOptions = {
			rulesPath: FIXTURE_DIR,
			memoryDir,
			quality: "high",
			dryRun: false,
		};
		const result = await ingestRules(opts);
		assert.equal(result.exitCode, 0);
		assert.ok(result.added >= 1);
	});

	it("splits by headings (## and ###) to create sections", async () => {
		const { ingestRules } = await importRules();

		// Create a fixture with multiple sections
		const multiSectionDir = join(tempDir, "multi-section");
		mkdirSync(multiSectionDir, { recursive: true });
		writeFileSync(
			join(multiSectionDir, "CLAUDE.md"),
			`# Rules

## Section Alpha

Alpha content here with enough text to be a lesson.

## Section Beta

Beta content here with different guidance.

### Sub-section Gamma

Gamma details about a specific pattern.
`,
		);

		const result = await ingestRules({
			rulesPath: multiSectionDir,
			memoryDir,
			quality: "default",
			dryRun: false,
		});

		assert.equal(result.exitCode, 0);
		// Should produce at least 3 lessons (one per section)
		assert.ok(
			result.added >= 3,
			`Expected at least 3 lessons from 3 sections, got ${result.added}`,
		);
	});

	it("handles a rules dir with no canonical files gracefully", async () => {
		const { ingestRules } = await importRules();

		const emptyRulesDir = join(tempDir, "no-rules");
		mkdirSync(emptyRulesDir, { recursive: true });
		writeFileSync(join(emptyRulesDir, "README.md"), "# Nothing useful");

		const result = await ingestRules({
			rulesPath: emptyRulesDir,
			memoryDir,
			quality: "default",
			dryRun: false,
		});

		assert.equal(result.exitCode, 0);
		assert.equal(result.added, 0, "Should add 0 lessons when no canonical files exist");
	});

	it("idempotent on re-run: dedup key is source-based, not LLM-output-based (VAL-M1-013)", async () => {
		const { ingestRules } = await importRules();

		// Create a simple fixture with one section
		const singleDir = join(tempDir, "dedup-source-test");
		mkdirSync(singleDir, { recursive: true });
		writeFileSync(
			join(singleDir, "CLAUDE.md"),
			`# Rules\n\n## Test Rule Alpha\n\nThis is a rule about testing with enough text for extraction.\n`,
		);

		const opts: IngestRulesOptions = {
			rulesPath: singleDir,
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		// First run
		const result1 = await ingestRules(opts);
		assert.equal(result1.exitCode, 0);
		assert.ok(result1.added >= 1, "First run should add at least 1 lesson");

		// Second run (same source content, potentially different LLM output)
		const result2 = await ingestRules(opts);
		assert.equal(result2.exitCode, 0);
		assert.equal(
			result2.added,
			0,
			"Second run should add 0 lessons (source-based dedup, not LLM-output-based)",
		);
		assert.equal(
			result2.skipped,
			result1.added,
			"Second run should skip all sections from first run",
		);

		// Verify lesson count unchanged
		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons();
			assert.equal(
				items.length,
				result1.added,
				"Total lesson count should match first run's added count",
			);

			// Verify source_hash is stored on lessons
			for (const lesson of items) {
				assert.ok(lesson.source_hash, `Lesson ${lesson.id} should have source_hash set`);
			}
		} finally {
			await adapter.shutdown();
		}
	});

	it("per-section dedup: modifying one section re-extracts only that section (VAL-M1-030)", async () => {
		const { ingestRules } = await importRules();

		// Create a fixture with two sections
		const multiDir = join(tempDir, "per-section-dedup");
		mkdirSync(multiDir, { recursive: true });

		const originalContent = `# Rules

## Section Alpha

Alpha content here with enough text to be considered a lesson on its own.

## Section Beta

Beta content here with different guidance and enough text for extraction.
`;
		writeFileSync(join(multiDir, "CLAUDE.md"), originalContent);

		const opts: IngestRulesOptions = {
			rulesPath: multiDir,
			memoryDir,
			quality: "default",
			dryRun: false,
		};

		// First run
		const result1 = await ingestRules(opts);
		assert.equal(result1.exitCode, 0);
		assert.ok(result1.added >= 2, "First run should add at least 2 lessons (one per section)");
		const firstRunCount = result1.added;

		// Modify only one section
		const modifiedContent = `# Rules

## Section Alpha

Alpha content here with enough text to be considered a lesson on its own.

## Section Beta

MODIFIED Beta content that has been changed to test per-section dedup behavior.
`;
		writeFileSync(join(multiDir, "CLAUDE.md"), modifiedContent);

		// Second run with modified section
		const result2 = await ingestRules(opts);
		assert.equal(result2.exitCode, 0);
		assert.equal(
			result2.added,
			1,
			"Second run should add exactly 1 lesson (only the modified section)",
		);
		assert.equal(
			result2.skipped,
			result1.added - 1,
			"Second run should skip all unchanged sections",
		);

		// Verify total count is first + 1
		const adapter = await MemoryAdapter.fromConfig(makeConfig(memoryDir));
		try {
			const { items } = await adapter.listLessons();
			assert.equal(
				items.length,
				firstRunCount + 1,
				"Total lessons should be original count + 1 (modified section)",
			);
		} finally {
			await adapter.shutdown();
		}
	});
});
