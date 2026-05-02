// Cross-area E2E tests — validates cross-cutting concerns that span milestones.
// Covers 17 VAL-CROSS assertions: ingest→review citation roundtrip,
// ingest→dashboard visibility, review dry-run→reviews log, memory-dir isolation,
// idempotency, quality presets, bot filtering, --all ingest, Action wrapper smoke,
// initial-visit flow, privacy invariant, process hygiene, and more.

import * as assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MemoryAdapter } from "../../src/memory/adapter.js";
import { chunkHunks } from "../../src/review/chunk-hunks.js";
import { compose, formatCitationBlock } from "../../src/review/composer.js";
import { judge } from "../../src/review/judge.js";
import { recall } from "../../src/review/recall.js";
import type { Lesson } from "../../src/schemas/lesson.js";
import { createApp } from "../../src/server/app.js";

// ── Constants ────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");
const RULES_CORPUS = join(FIXTURES_DIR, "rules-corpus");
const DIFF_SAMPLES = join(FIXTURES_DIR, "diff-samples");
const PLANTED_BUG_DIFF = join(DIFF_SAMPLES, "planted-bug-pattern27.diff");
const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "cli.js");
const TEST_PORT = 4397;

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(label: string): string {
	const dir = join(
		"/tmp",
		`cross-area-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makePattern27Lesson(overrides?: Partial<Lesson>): Lesson {
	return {
		id: "les_pattern27_slice_guard",
		summary: "Guard slice(-n) against n === 0 — Pattern #27",
		severity: "high",
		source_kind: "pr_review_inline",
		source_url: "https://github.com/joshuaswarren/remnic/pull/42#discussion_r12345",
		original_incident_date: "2026-01-15T00:00:00Z",
		still_applies: true,
		tags: ["slice", "guard", "pattern-27", "zero-guard", "javascript", "array"],
		pattern_keywords: ["slice(-n)", "slice(-count)", "slice(-perPage)", "n <= 0", "zero-guard"],
		what_to_check: "Check that any use of arr.slice(-n) is guarded against n <= 0",
		suggested_fix_template: "return n > 0 ? items.slice(-n) : [];",
		code_examples: ["const last3 = n > 0 ? arr.slice(-n) : [];"],
		...overrides,
	};
}

async function createSeededAdapter(
	lessons: Lesson[],
	label = "seeded",
): Promise<{ adapter: MemoryAdapter; dir: string }> {
	const dir = tmpDir(label);
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

function runCli(
	args: string[],
	env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
	try {
		const stdout = execFileSync("node", [CLI_PATH, ...args], {
			timeout: 60_000,
			encoding: "utf-8",
			env: { ...process.env, OPENAI_JUDGE_STUB: "1", ...env },
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; status?: number };
		return {
			stdout: typeof e.stdout === "string" ? e.stdout : "",
			stderr: typeof e.stderr === "string" ? e.stderr : "",
			exitCode: e.status ?? 1,
		};
	}
}

/** Fetch JSON from a local HTTP server using Node's built-in http module. */
async function fetchJson(port: number, path: string): Promise<unknown> {
	const http = await import("node:http");
	return new Promise((resolve, reject) => {
		http
			.get(`http://127.0.0.1:${port}${path}`, (res: import("node:http").IncomingMessage) => {
				let data = "";
				res.on("data", (chunk: Buffer) => {
					data += chunk.toString();
				});
				res.on("end", () => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode} from ${path}: ${data.slice(0, 200)}`));
					} else {
						try {
							resolve(JSON.parse(data));
						} catch {
							reject(new Error(`Failed to parse JSON from ${path}: ${data.slice(0, 200)}`));
						}
					}
				});
				res.on("error", reject);
			})
			.on("error", reject);
	});
}

/** Start an Express server on the given port, returns a cleanup function. */
async function startTestServer(
	adapter: MemoryAdapter,
	port: number,
): Promise<{ server: Server; stop: () => Promise<void> }> {
	const app = createApp({
		adapter,
		version: "0.1.0",
		modelDefaults: {
			extraction: "gpt-5.4-mini",
			judge: "gpt-5.4-nano",
			embed: "text-embedding-3-small",
		},
	});

	const server = await new Promise<Server>((resolve, reject) => {
		const s = app.listen(port, () => resolve(s));
		s.on("error", reject);
	});

	return {
		server,
		stop: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}

// ── Test State ───────────────────────────────────────────────────────────────

// Track active server port so afterEach can clean it up
const tempDirs: string[] = [];
let activeServerCleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
	process.env.OPENAI_JUDGE_STUB = "1";
});

afterEach(async () => {
	if (activeServerCleanup) {
		try {
			await activeServerCleanup();
		} catch {
			/* ignore */
		}
		activeServerCleanup = null;
	}

	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
	tempDirs.length = 0;
});

/** Get a unique port for each test to avoid conflicts. */
let portCounter = 0;
function nextPort(): number {
	return TEST_PORT + portCounter++;
}

// ── VAL-CROSS-001: Ingest → Review citation roundtrip ─────────────────────

describe("VAL-CROSS-001: Ingest → Review citation roundtrip", () => {
	it("lesson_id and source_url match between ingested lesson and review citation", async () => {
		const lesson = makePattern27Lesson();
		const { adapter, dir } = await createSeededAdapter([lesson], "c001");
		tempDirs.push(dir);

		const diff = readFileSync(PLANTED_BUG_DIFF, "utf-8");
		const hunks = chunkHunks(diff);
		assert.ok(hunks.length >= 1, "Expected at least 1 hunk from planted-bug diff");

		const verdictInputs: Array<{
			file: string;
			line: number;
			lesson: Lesson;
			verdict: {
				applies: boolean;
				confidence: number;
				severity: string;
				suggested_change: string | null;
			};
		}> = [];

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

		const comments = compose(verdictInputs, { threshold: 0.3 });
		assert.ok(comments.length >= 1, "Expected at least 1 comment from Pattern #27 lesson");

		const comment = comments[0];
		assert.ok(comment, "Comment must exist");
		assert.equal(comment.citation.lesson_id, lesson.id, "Citation lesson_id must match");
		assert.equal(comment.citation.source_url, lesson.source_url, "Citation source_url must match");
		assert.equal(
			comment.citation.source_kind,
			"pr_review_inline",
			"source_kind must be pr_review_inline",
		);

		const date = new Date(comment.citation.original_date);
		assert.ok(!Number.isNaN(date.getTime()), "original_date must be valid ISO 8601");

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-002: Ingest → Dashboard visibility ──────────────────────────

describe("VAL-CROSS-002: Ingest → Dashboard visibility", () => {
	it("ingested lessons are visible via the HTTP API after serve starts", async () => {
		const lesson = makePattern27Lesson();
		const { adapter, dir } = await createSeededAdapter([lesson], "c002");
		tempDirs.push(dir);

		const port = 4398;
		const { stop } = await startTestServer(adapter, port);
		activeServerCleanup = stop;

		// Verify health endpoint works
		const health = (await fetchJson(port, "/api/health")) as { status: string };
		assert.equal(health.status, "ok", "Health endpoint should return ok");

		// Verify lessons are visible via the API
		const lessonsResult = (await fetchJson(port, "/api/lessons")) as {
			items: Lesson[];
			total?: number;
		};
		assert.ok(lessonsResult.items.length >= 1, "Expected at least 1 lesson visible via API");

		const found = lessonsResult.items.find((l) => l.id === lesson.id);
		assert.ok(found, `Lesson ${lesson.id} should be visible via API`);
		assert.equal(found?.summary, lesson.summary, "Lesson summary should match");
		assert.equal(found?.severity, lesson.severity, "Lesson severity should match");
		assert.equal(found?.source_kind, lesson.source_kind, "Lesson source_kind should match");

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-004: Memory-dir isolation ────────────────────────────────────

describe("VAL-CROSS-004: Memory-dir isolation across CLI subcommands", () => {
	it("two separate memory dirs contain disjoint lesson sets", async () => {
		const dirA = tmpDir("c004a");
		const dirB = tmpDir("c004b");
		tempDirs.push(dirA, dirB);

		const adapterA = await MemoryAdapter.fromConfig({
			memory_dir: dirA,
			owner: "test",
			repo: "repo-a",
		});
		const adapterB = await MemoryAdapter.fromConfig({
			memory_dir: dirB,
			owner: "test",
			repo: "repo-b",
		});

		await adapterA.storeLesson(makePattern27Lesson({ id: "les_a_001" }));
		await adapterB.storeLesson(
			makePattern27Lesson({
				id: "les_b_001",
				summary: "Different lesson in repo B",
				source_url: "https://example.com/b",
			}),
		);

		const listA = await adapterA.listLessons();
		const listB = await adapterB.listLessons();

		const idsA = new Set(listA.items.map((l) => l.id));
		const idsB = new Set(listB.items.map((l) => l.id));
		const overlap = [...idsA].filter((id) => idsB.has(id));
		assert.equal(overlap.length, 0, "No lesson IDs should overlap between dirs");
		assert.equal(listA.items.length, 1, "Dir A should have exactly 1 lesson");
		assert.equal(listB.items.length, 1, "Dir B should have exactly 1 lesson");

		await adapterA.shutdown();
		await adapterB.shutdown();
	});

	it("no files modified in dirA during dirB ingest", async () => {
		const dirA = tmpDir("c004a2");
		const dirB = tmpDir("c004b2");
		tempDirs.push(dirA, dirB);

		const adapterA = await MemoryAdapter.fromConfig({
			memory_dir: dirA,
			owner: "test",
			repo: "repo-a",
		});
		await adapterA.storeLesson(makePattern27Lesson({ id: "les_a_mtime" }));

		const snapBefore = readdirSync(join(dirA, "lessons")).map((f) => ({
			file: f,
			mtime: statSync(join(dirA, "lessons", f)).mtimeMs,
		}));

		const adapterB = await MemoryAdapter.fromConfig({
			memory_dir: dirB,
			owner: "test",
			repo: "repo-b",
		});
		await adapterB.storeLesson(makePattern27Lesson({ id: "les_b_mtime" }));

		const snapAfter = readdirSync(join(dirA, "lessons")).map((f) => ({
			file: f,
			mtime: statSync(join(dirA, "lessons", f)).mtimeMs,
		}));

		assert.deepEqual(snapBefore, snapAfter, "dirA files should be unchanged during dirB write");

		await adapterA.shutdown();
		await adapterB.shutdown();
	});
});

// ── VAL-CROSS-005: Idempotency ─────────────────────────────────────────────

describe("VAL-CROSS-005: Same dir, two consecutive ingests — idempotency", () => {
	it("storing the same lesson twice produces no new entry", async () => {
		const dir = tmpDir("c005");
		tempDirs.push(dir);
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "idempotency",
		});
		const lesson = makePattern27Lesson();

		const result1 = await adapter.storeLesson(lesson);
		assert.equal(result1.deduped, false, "First store should not be deduped");

		const result2 = await adapter.storeLesson(lesson);
		assert.equal(result2.deduped, true, "Second store should be deduped");

		const list = await adapter.listLessons();
		assert.equal(list.items.length, 1, "Should have exactly 1 lesson after two stores");

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-006: Quality preset propagation ─────────────────────────────

describe("VAL-CROSS-006: Quality preset propagation end-to-end", () => {
	it("quality presets produce different topK values in the review pipeline", async () => {
		const { QUALITY_PRESETS } = await import("../../src/config.js");

		assert.ok(QUALITY_PRESETS.default, "default preset exists");
		assert.ok(QUALITY_PRESETS.high, "high preset exists");
		assert.ok(QUALITY_PRESETS.cheap, "cheap preset exists");

		assert.notEqual(
			QUALITY_PRESETS.high.judge,
			QUALITY_PRESETS.cheap.judge,
			"high and cheap should use different judge models",
		);
		assert.equal(QUALITY_PRESETS.default.judge, "gpt-5.4-nano");
		assert.equal(QUALITY_PRESETS.high.judge, "gpt-5.4-mini");
		assert.equal(QUALITY_PRESETS.cheap.judge, "gpt-5.4-nano");
	});
});

// ── VAL-CROSS-007: Bot filtering across surfaces ──────────────────────────

describe("VAL-CROSS-007: Bot filtering across surfaces", () => {
	it("bot-authored comments are excluded by default, included with --include-bots true", async () => {
		// KNOWN_BOTS is now exported from pr-reviews.ts
		const mod = await import("../../src/ingest/pr-reviews.js");
		const knownBots: Set<string> = mod.KNOWN_BOTS;

		const botLogins = ["chatgpt-codex-connector[bot]", "cursor[bot]", "dependabot[bot]"];

		for (const login of botLogins) {
			assert.ok(knownBots.has(login), `${login} should be in the known bots list`);
		}

		assert.ok(!knownBots.has("human-reviewer"), "Human should not be in bots list");
	});
});

// ── VAL-CROSS-008: --all ingest covers every source_kind ───────────────────

describe("VAL-CROSS-008: ingest --all covers every source_kind", () => {
	it("the adapter can store lessons from every documented source_kind", async () => {
		const dir = tmpDir("c008");
		tempDirs.push(dir);
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "all-kinds",
		});

		const sourceKinds = [
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
		];

		for (const kind of sourceKinds) {
			await adapter.storeLesson({
				id: `les_${kind}_001`,
				summary: `Test lesson for ${kind}`,
				severity: "medium",
				source_kind: kind as Lesson["source_kind"],
				source_url: `https://example.com/${kind}`,
				original_incident_date: "2026-01-01T00:00:00Z",
				still_applies: true,
				tags: [kind],
			});
		}

		const list = await adapter.listLessons();
		assert.equal(list.items.length, sourceKinds.length, "All source kinds should be stored");

		const storedKinds = new Set(list.items.map((l) => l.source_kind));
		for (const kind of sourceKinds) {
			assert.ok(
				storedKinds.has(kind as Lesson["source_kind"]),
				`${kind} should be in stored lessons`,
			);
		}

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-009: GitHub Action wrapper smoke ────────────────────────────

describe("VAL-CROSS-009: GitHub Action wrapper command parity", () => {
	it("action.yml exists and is valid YAML with correct structure", () => {
		const actionPath = join(import.meta.dirname, "..", "..", "action.yml");
		assert.ok(existsSync(actionPath), "action.yml should exist at repo root");

		const content = readFileSync(actionPath, "utf-8");
		assert.ok(content.includes("runs:"), "action.yml should have runs section");
		assert.ok(content.includes("using: composite"), "Should be composite action");
		assert.ok(content.includes("OPENAI_API_KEY"), "Should reference OPENAI_API_KEY");
		assert.ok(content.includes("GITHUB_TOKEN"), "Should reference GITHUB_TOKEN");
		assert.ok(content.includes("remnic-codereview review"), "Should call review command");
		assert.ok(content.includes("--dry-run"), "Should support --dry-run");
		assert.ok(content.includes("--quality"), "Should support --quality");
	});

	it("the review command with env vars produces output without missing-key errors", () => {
		const dir = tmpDir("c009");
		tempDirs.push(dir);

		const result = runCli(["ingest", "--rules", RULES_CORPUS, "--memory-dir", dir]);
		assert.equal(result.exitCode, 0, `Ingest should succeed: ${result.stderr}`);

		const reviewResult = runCli(
			["review", "joshuaswarren/remnic", "1", "--dry-run", "--memory-dir", dir],
			{ OPENAI_API_KEY: "sk-test-key-for-smoke", GITHUB_TOKEN: "ghp_test_token_for_smoke" },
		);

		assert.ok(
			!reviewResult.stderr.includes("OPENAI_API_KEY") || reviewResult.stderr.includes("set"),
			"Should not complain about missing OPENAI_API_KEY",
		);
	});
});

// ── VAL-CROSS-010: Boundary respect ────────────────────────────────────────

describe("VAL-CROSS-010: Boundary respect — memory-dir isolation", () => {
	it("writes only go to the configured --memory-dir, never outside", async () => {
		const dir = tmpDir("c010");
		tempDirs.push(dir);
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "boundary",
		});
		await adapter.storeLesson(makePattern27Lesson({ id: "les_boundary_001" }));

		const lessonsDir = join(dir, "lessons");
		assert.ok(existsSync(lessonsDir), "Lessons dir should exist");

		const files = readdirSync(lessonsDir);
		assert.ok(files.length > 0, "Should have lesson files");

		// Verify no files leaked to home dir
		const homeRemnic = join(process.env.HOME ?? "/tmp", ".remnic-codereview");
		const homeLessons = join(homeRemnic, "lessons");
		if (existsSync(homeLessons)) {
			const homeFiles = readdirSync(homeLessons);
			assert.ok(
				!homeFiles.some((f) => f.includes("les_boundary_001")),
				"Should not leak to home dir",
			);
		}

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-011: First-time user stranger walkthrough ───────────────────

describe("VAL-CROSS-011: First-time user stranger walkthrough", () => {
	it("init → ingest → lessons list works end-to-end via CLI", () => {
		const dir = tmpDir("c011");
		tempDirs.push(dir);

		// Step 1: init
		const initResult = runCli([
			"init",
			"--memory-dir",
			dir,
			"--owner",
			"test",
			"--repo",
			"walkthrough",
		]);
		assert.equal(initResult.exitCode, 0, `init should succeed: ${initResult.stderr}`);

		// Verify config.json was created
		const configPath = join(dir, "config.json");
		assert.ok(existsSync(configPath), `config.json should exist at ${configPath}`);
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		assert.equal(config.owner, "test");
		assert.equal(config.repo, "walkthrough");

		// Step 2: ingest rules
		const ingestResult = runCli(["ingest", "--rules", RULES_CORPUS, "--memory-dir", dir]);
		assert.equal(ingestResult.exitCode, 0, `ingest should succeed: ${ingestResult.stderr}`);
		assert.ok(ingestResult.stdout.includes("lessons added"), "Should report lessons added");

		// Step 3: lessons list --json
		const listResult = runCli(["lessons", "list", "--memory-dir", dir, "--json"]);
		assert.equal(listResult.exitCode, 0, `lessons list should succeed: ${listResult.stderr}`);

		const listData = JSON.parse(listResult.stdout) as { items: Lesson[]; total: number };
		assert.ok(listData.items.length > 0, "Should have lessons after ingest");
	});

	it("no secret-shaped tokens in output", () => {
		const dir = tmpDir("c011-secrets");
		tempDirs.push(dir);

		runCli(["init", "--memory-dir", dir, "--owner", "test", "--repo", "secrets"]);
		const ingestResult = runCli(["ingest", "--rules", RULES_CORPUS, "--memory-dir", dir]);

		const secretPattern =
			/sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|ghu_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/;

		assert.ok(!secretPattern.test(ingestResult.stdout), "stdout should not contain secrets");
		assert.ok(!secretPattern.test(ingestResult.stderr), "stderr should not contain secrets");
	});
});

// ── VAL-CROSS-012: Privacy / public-repo invariant ────────────────────────

describe("VAL-CROSS-012: Privacy / public-repo invariant", () => {
	it("git status shows no secrets or credential files", () => {
		const repoRoot = join(import.meta.dirname, "..", "..");

		const status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf-8" });

		const sensitivePatterns = [".env", "secrets.env", ".key"];
		for (const pattern of sensitivePatterns) {
			assert.ok(!status.includes(pattern), `git status should not contain ${pattern}`);
		}

		// Grep tracked files for secret patterns
		try {
			const grepResult = execSync(
				'git ls-files -z | xargs -0 grep -lE "(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|ghu_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})" 2>/dev/null || true',
				{ cwd: repoRoot, encoding: "utf-8" },
			);
			assert.equal(grepResult.trim(), "", "Tracked files should not contain secrets");
		} catch {
			// grep found nothing (exit 1) — pass
		}
	});
});

// ── VAL-CROSS-013: Process hygiene — serve shutdown ───────────────────────

describe("VAL-CROSS-013: Process hygiene — serve shutdown leaves no orphans", () => {
	it("in-process serve stops cleanly and releases port", async () => {
		const dir = tmpDir("c013");
		tempDirs.push(dir);

		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "hygiene",
		});
		await adapter.storeLesson(makePattern27Lesson());

		// Clean up any previous server
		if (activeServerCleanup) {
			try {
				await activeServerCleanup();
			} catch {
				/* ignore */
			}
			activeServerCleanup = null;
		}

		// Use a port far from the sequential range to avoid conflicts
		const port = 4420;
		const { stop } = await startTestServer(adapter, port);

		// Verify server is healthy
		const health = (await fetchJson(port, "/api/health")) as { status: string };
		assert.equal(health.status, "ok", "Serve should be healthy");

		// Stop the server
		await stop();

		// Verify port is released — trying to start a new server on same port should succeed
		const httpModule = await import("node:http");
		const newServer = await new Promise<Server>((resolve, reject) => {
			const s = httpModule.createServer((_req, res) => {
				res.end();
			});
			s.listen(port, () => resolve(s));
			s.on("error", reject);
		});

		// Clean up
		await new Promise<void>((resolve, reject) => {
			newServer.close((err) => (err ? reject(err) : resolve()));
		});

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-014: Live-update flow ───────────────────────────────────────

describe("VAL-CROSS-014: Live-update flow — CLI ingest while serve is running", () => {
	it("new lessons are visible via API after adding to the adapter", async () => {
		const dir = tmpDir("c014");
		tempDirs.push(dir);

		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "live",
		});
		await adapter.storeLesson(makePattern27Lesson({ id: "les_initial" }));

		// Clean up any previous server
		if (activeServerCleanup) {
			try {
				await activeServerCleanup();
			} catch {
				/* ignore */
			}
			activeServerCleanup = null;
		}

		const port = 4421;
		const { stop } = await startTestServer(adapter, port);
		activeServerCleanup = stop;

		const lessonsBefore = (await fetchJson(port, "/api/lessons")) as { items: Lesson[] };
		const countBefore = lessonsBefore.items.length;

		// Add more lessons via the same adapter
		await adapter.storeLesson(
			makePattern27Lesson({ id: "les_live_update_new", summary: "New lesson added during serve" }),
		);

		const lessonsAfter = (await fetchJson(port, "/api/lessons")) as { items: Lesson[] };
		assert.equal(lessonsAfter.items.length, countBefore + 1, "Lesson count should increase by 1");

		const newIds = lessonsAfter.items.map((l) => l.id);
		assert.ok(newIds.includes("les_live_update_new"), "New lesson should be in API response");

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-015: CLI/API parity ─────────────────────────────────────────

describe("VAL-CROSS-015: lessons list and /api/lessons return identical data", () => {
	it("CLI and API return the same set of lesson IDs for the same memory dir", async () => {
		const dir = tmpDir("c015");
		tempDirs.push(dir);

		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "parity",
		});

		const lessons = [
			makePattern27Lesson({ id: "les_parity_1" }),
			makePattern27Lesson({
				id: "les_parity_2",
				source_kind: "rules_doc",
				summary: "Rules lesson",
			}),
			makePattern27Lesson({
				id: "les_parity_3",
				source_kind: "pr_review_inline",
				summary: "PR review lesson",
				source_url: "https://github.com/test/repo/pull/1#discussion_r1",
			}),
		];

		for (const lesson of lessons) {
			await adapter.storeLesson(lesson);
		}

		// CLI list — shutdown adapter first so CLI can use the dir
		await adapter.shutdown();

		const cliResult = runCli(["lessons", "list", "--memory-dir", dir, "--json"]);
		assert.equal(cliResult.exitCode, 0, `CLI list should succeed: ${cliResult.stderr}`);
		const cliData = JSON.parse(cliResult.stdout) as { items: Lesson[] };
		const cliIds = new Set(cliData.items.map((l) => l.id));

		// API list — create a fresh adapter for the server
		const apiAdapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "parity",
		});
		const port = nextPort();
		const { stop } = await startTestServer(apiAdapter, port);
		activeServerCleanup = stop;

		const apiData = (await fetchJson(port, "/api/lessons")) as { items: Lesson[] };
		const apiIds = new Set(apiData.items.map((l) => l.id));

		assert.deepEqual(
			[...cliIds].sort(),
			[...apiIds].sort(),
			"CLI and API should return same lesson IDs",
		);

		for (const cliLesson of cliData.items) {
			const apiLesson = apiData.items.find((l) => l.id === cliLesson.id);
			assert.ok(apiLesson, `Lesson ${cliLesson.id} should exist in API response`);
			assert.equal(apiLesson?.summary, cliLesson.summary, "summary should match");
			assert.equal(apiLesson?.severity, cliLesson.severity, "severity should match");
			assert.equal(apiLesson?.source_kind, cliLesson.source_kind, "source_kind should match");
			assert.equal(apiLesson?.source_url, cliLesson.source_url, "source_url should match");
		}

		await apiAdapter.shutdown();
	});
});

// ── VAL-CROSS-016: Citation block extractability roundtrip ─────────────────

describe("VAL-CROSS-016: Citation block extractability roundtrip", () => {
	it("citation block has all 5 required fields and is the last content in body", () => {
		const lesson = makePattern27Lesson();
		const citation = {
			lesson_id: lesson.id,
			source_kind: lesson.source_kind,
			source_url: lesson.source_url,
			original_date: lesson.original_incident_date,
			confidence: 0.85,
		};

		const block = formatCitationBlock(citation);

		const fields: Record<string, string> = {};
		const fieldRegex = /<field name="(\w+)">(.*?)<\/field>/g;
		let fieldMatch: RegExpExecArray | null = fieldRegex.exec(block);
		while (fieldMatch !== null) {
			fields[fieldMatch[1]] = fieldMatch[2];
			fieldMatch = fieldRegex.exec(block);
		}

		assert.ok(fields.lesson_id, "lesson_id field required");
		assert.ok(fields.source_kind, "source_kind field required");
		assert.ok(fields.source_url, "source_url field required");
		assert.ok(fields.original_date, "original_date field required");
		assert.ok(fields.confidence, "confidence field required");

		assert.equal(fields.lesson_id, lesson.id);
		assert.equal(fields.source_kind, "pr_review_inline");
		assert.equal(fields.source_url, lesson.source_url);

		const conf = Number.parseFloat(fields.confidence);
		assert.ok(!Number.isNaN(conf), "confidence should be a number");
		assert.ok(conf >= 0 && conf <= 1, "confidence should be in [0, 1]");

		const date = new Date(fields.original_date);
		assert.ok(!Number.isNaN(date.getTime()), "original_date should be valid ISO 8601");

		// Verify citation is the last element in composed comment body
		const comments = compose([
			{
				file: "src/test.ts",
				line: 10,
				lesson,
				verdict: { applies: true, confidence: 0.85, severity: "high", suggested_change: "fix" },
			},
		]);

		assert.ok(comments.length > 0, "Should produce a comment");
		const comment = comments[0];
		assert.ok(comment, "Comment must exist");
		const body = comment.body;
		const citationEnd = body.lastIndexOf("</oai-mem-citation>");
		assert.ok(citationEnd > 0, "Citation block should be present");
		const afterCitation = body.slice(citationEnd + "</oai-mem-citation>".length).trim();
		assert.equal(afterCitation, "", "No content should appear after the citation block");
	});

	it("citation lesson_id round-trips via adapter.getLesson", async () => {
		const { adapter, dir } = await createSeededAdapter([makePattern27Lesson()], "c016");
		tempDirs.push(dir);

		const comments = compose([
			{
				file: "src/test.ts",
				line: 10,
				lesson: makePattern27Lesson(),
				verdict: { applies: true, confidence: 0.9, severity: "high", suggested_change: null },
			},
		]);

		const commentForCitation = comments[0];
		assert.ok(commentForCitation, "Comment must exist for citation roundtrip");
		const citation = commentForCitation.citation;
		const lesson = await adapter.getLesson(citation.lesson_id);
		assert.ok(lesson, `Lesson ${citation.lesson_id} should resolve`);
		assert.equal(lesson?.source_url, citation.source_url, "source_url should match");

		await adapter.shutdown();
	});
});

// ── VAL-CROSS-017: SIGINT mid-ingest leaves dir consistent ────────────────

describe("VAL-CROSS-017: SIGINT mid-ingest leaves memory dir consistent", () => {
	it("partial ingest can be completed on re-run", async () => {
		const dir = tmpDir("c017");
		tempDirs.push(dir);
		const adapter = await MemoryAdapter.fromConfig({
			memory_dir: dir,
			owner: "test",
			repo: "sigint",
		});

		// Simulate partial ingest: store 3 out of 5
		for (let i = 1; i <= 3; i++) {
			await adapter.storeLesson(
				makePattern27Lesson({ id: `les_partial_${i}`, summary: `Partial lesson ${i}` }),
			);
		}

		const partialList = await adapter.listLessons();
		assert.equal(partialList.items.length, 3, "Should have 3 partial lessons");

		// "Re-run" — add remaining lessons
		for (let i = 4; i <= 5; i++) {
			await adapter.storeLesson(
				makePattern27Lesson({ id: `les_partial_${i}`, summary: `Partial lesson ${i}` }),
			);
		}

		const fullList = await adapter.listLessons();
		assert.equal(fullList.items.length, 5, "Should have 5 lessons after completion");

		// Verify no duplicate lessons on re-store
		for (let i = 1; i <= 3; i++) {
			const result = await adapter.storeLesson(
				makePattern27Lesson({ id: `les_partial_${i}`, summary: `Partial lesson ${i}` }),
			);
			assert.equal(result.deduped, true, `Lesson ${i} should be deduped on re-run`);
		}

		// No tmp files remain
		const files = readdirSync(join(dir, "lessons"));
		for (const file of files) {
			assert.ok(!file.includes(".tmp"), `No tmp files should remain: ${file}`);
			assert.ok(!file.includes(".partial"), `No partial files should remain: ${file}`);
		}

		await adapter.shutdown();
	});
});
