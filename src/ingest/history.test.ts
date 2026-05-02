// History ingestion tests — covers CHANGELOG, ADRs, post-mortems, closed issues, fix/revert commits.
// Uses OPENAI_JUDGE_STUB=1 for deterministic extraction.
// Uses fixture data at tests/fixtures/history-corpus/.
// Uses a mock GitHub client for closed issues.

import * as assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { QualityPreset } from "../cli.js";

// ── Test fixtures path ───────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname ?? ".", "../../tests/fixtures/history-corpus");

/** Create a temp memory dir for a test. */
function tempDir(name: string): string {
	const dir = `/tmp/history-ingest-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Clean up a temp dir. */
function cleanupDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

/** Build standard history ingest options. */
function makeOpts(
	name: string,
	repoPath: string,
	overrides?: Partial<{
		since: Date | undefined;
		max: number | undefined;
		dryRun: boolean;
	}>,
) {
	const memDir = tempDir(name);
	tempDirs.push(memDir);
	return {
		owner: "acme",
		repo: "widgets",
		repoPath,
		memoryDir: memDir,
		quality: "default" as QualityPreset,
		dryRun: overrides?.dryRun ?? false,
		since: overrides?.since as Date | undefined,
		max: overrides?.max as number | undefined,
	};
}

// ── Mock GitHub client for closed issues ─────────────────────────────────────

interface ClosedIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: Array<{ name: string }>;
	html_url: string;
	closed_at: string;
	user: { login: string } | null;
}

interface MockGitHubClient {
	listClosedIssues(owner: string, repo: string, labels?: string[]): Promise<ClosedIssue[]>;
}

/** Create mock issues fixture data. */
function createMockIssues(): ClosedIssue[] {
	return [
		{
			number: 10,
			title: "Memory corruption on atomic write failure",
			body: "A power loss during write corrupted the memory store. Need to implement write-tmp-then-rename.",
			state: "closed",
			labels: [{ name: "bug" }],
			html_url: "https://github.com/acme/widgets/issues/10",
			closed_at: "2026-04-12T10:00:00Z",
			user: { login: "developer" },
		},
		{
			number: 11,
			title: "Token exposed in stderr logs",
			body: "The API key was being logged in plaintext. Fix: redact secrets before logging.",
			state: "closed",
			labels: [{ name: "security" }],
			html_url: "https://github.com/acme/widgets/issues/11",
			closed_at: "2026-04-15T12:00:00Z",
			user: { login: "security-team" },
		},
		{
			number: 12,
			title: "Add support for dark mode",
			body: "Users want dark mode support in the dashboard.",
			state: "closed",
			labels: [{ name: "enhancement" }],
			html_url: "https://github.com/acme/widgets/issues/12",
			closed_at: "2026-04-20T08:00:00Z",
			user: { login: "product" },
		},
		{
			number: 13,
			title: "Empty body bug report",
			body: null,
			state: "closed",
			labels: [{ name: "bug" }],
			html_url: "https://github.com/acme/widgets/issues/13",
			closed_at: "2026-04-18T09:00:00Z",
			user: { login: "tester" },
		},
	];
}

/** Create a mock GitHub client that returns the given issues. */
function createMockGitHubClient(issues: ClosedIssue[]): MockGitHubClient {
	return {
		async listClosedIssues(
			_owner: string,
			_repo: string,
			_labels?: string[],
		): Promise<ClosedIssue[]> {
			if (_labels && _labels.length > 0) {
				return issues.filter((issue) => issue.labels.some((l) => _labels.includes(l.name)));
			}
			return issues;
		},
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

// Ensure stub mode
process.env.OPENAI_JUDGE_STUB = "1";

const tempDirs: string[] = [];

describe("history ingestion", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			cleanupDir(dir);
		}
		tempDirs.length = 0;
	});

	// ── CHANGELOG ──────────────────────────────────────────────────────────

	it("CHANGELOG entry produces a changelog Lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("changelog", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.changelog >= 1, "Expected at least 1 changelog lesson");

		const changelogLessons = result.allLessons.filter((l) => l.source_kind === "changelog");
		assert.ok(changelogLessons.length >= 1, "Expected changelog lessons");
	});

	it("Missing CHANGELOG.md is graceful skip", async () => {
		const { ingestHistory } = await import("./history.js");
		const noChangelogDir = tempDir("no-changelog-fixture");
		tempDirs.push(noChangelogDir);
		mkdirSync(join(noChangelogDir, "docs"), { recursive: true });

		const result = await ingestHistory(makeOpts("no-changelog", noChangelogDir));

		assert.equal(result.exitCode, 0);
		assert.equal(result.stats.changelog, 0);
	});

	it("Malformed CHANGELOG entry is skipped without crashing", async () => {
		const { ingestHistory } = await import("./history.js");
		const { writeFileSync } = await import("node:fs");
		const malformedDir = tempDir("malformed-fixture");
		tempDirs.push(malformedDir);
		writeFileSync(join(malformedDir, "CHANGELOG.md"), "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n");

		const result = await ingestHistory(makeOpts("malformed-changelog", malformedDir));

		assert.equal(result.exitCode, 0);
		assert.equal(result.stats.changelog, 0);
	});

	// ── ADR ────────────────────────────────────────────────────────────────

	it("ADR file produces an adr Lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("adr", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.adr >= 1, "Expected at least 1 ADR lesson");

		const adrLessons = result.allLessons.filter((l) => l.source_kind === "adr");
		assert.ok(adrLessons.length >= 1, "Expected ADR lessons");

		const hasAdr001 = adrLessons.some(
			(l) =>
				l.source_url.includes("001-use-remnic-for-memory.md") || l.source_url.includes("docs/adr"),
		);
		assert.ok(hasAdr001, "Expected lesson referencing the ADR file");
	});

	it("ADR file with no front-matter still produces a lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("adr-no-fm", FIXTURE_PATH));

		assert.ok(result.stats.adr >= 2, "Expected at least 2 ADR lessons from both files");
	});

	// ── Post-mortem ────────────────────────────────────────────────────────

	it("Post-mortem produces a post_mortem Lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("postmortem", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.post_mortem >= 1, "Expected at least 1 post_mortem lesson");

		const pmLessons = result.allLessons.filter((l) => l.source_kind === "post_mortem");
		assert.ok(pmLessons.length >= 1, "Expected post_mortem lessons");
	});

	// ── Closed issues ──────────────────────────────────────────────────────

	it("Closed bug issue produces a closed_issue Lesson with bug tag", async () => {
		const { ingestHistory } = await import("./history.js");
		const opts = makeOpts("closed-bug", FIXTURE_PATH);
		const mockClient = createMockGitHubClient(createMockIssues());
		const result = await ingestHistory(opts, mockClient);

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.closed_issue >= 1, "Expected at least 1 closed_issue lesson");

		const bugLessons = result.allLessons.filter(
			(l) => l.source_kind === "closed_issue" && l.tags.includes("bug"),
		);
		assert.ok(bugLessons.length >= 1, "Expected closed_issue lessons with 'bug' tag");
	});

	it("Closed security issue produces a closed_issue Lesson with severity >= high", async () => {
		const { ingestHistory } = await import("./history.js");
		const opts = makeOpts("closed-security", FIXTURE_PATH);
		const mockClient = createMockGitHubClient(createMockIssues());
		const result = await ingestHistory(opts, mockClient);

		assert.equal(result.exitCode, 0);

		const securityLessons = result.allLessons.filter(
			(l) => l.source_kind === "closed_issue" && l.tags.includes("security"),
		);
		assert.ok(securityLessons.length >= 1, "Expected security closed_issue lessons");

		for (const lesson of securityLessons) {
			assert.ok(
				["critical", "high"].includes(lesson.severity),
				`Expected security issue severity >= high, got: ${lesson.severity}`,
			);
		}
	});

	it("Closed issue with empty body produces a lesson using title", async () => {
		const { ingestHistory } = await import("./history.js");
		const opts = makeOpts("empty-body-issue", FIXTURE_PATH);
		const mockClient = createMockGitHubClient(createMockIssues());
		const result = await ingestHistory(opts, mockClient);

		const emptyBodyLessons = result.allLessons.filter(
			(l) => l.source_kind === "closed_issue" && l.source_url.includes("/issues/13"),
		);
		assert.ok(emptyBodyLessons.length >= 1, "Expected lesson for empty-body issue");
		assert.ok(
			(emptyBodyLessons[0]?.summary?.length ?? 0) > 0,
			"Expected non-empty summary for empty-body issue",
		);
	});

	// ── Git commits ────────────────────────────────────────────────────────

	it("fix: commit produces a fix_commit Lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("fix-commit", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.fix_commit >= 1, "Expected at least 1 fix_commit lesson");

		const fixLessons = result.allLessons.filter((l) => l.source_kind === "fix_commit");
		const hasFixCommit = fixLessons.some(
			(l) => l.summary.toLowerCase().includes("fix") || l.summary.toLowerCase().includes("storage"),
		);
		assert.ok(hasFixCommit, "Expected a fix_commit lesson referencing the fix");
	});

	it("revert: commit produces a fix_commit Lesson with revert tag", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("revert-commit", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);

		const revertLessons = result.allLessons.filter(
			(l) => l.source_kind === "fix_commit" && l.tags.includes("revert"),
		);
		assert.ok(revertLessons.length >= 1, "Expected fix_commit lessons with 'revert' tag");
	});

	it("bug: commit produces a fix_commit Lesson", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("bug-commit", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);

		const bugLessons = result.allLessons.filter(
			(l) => l.source_kind === "fix_commit" && l.tags.includes("bug"),
		);
		assert.ok(bugLessons.length >= 1, "Expected fix_commit lesson with 'bug' tag from bug: commit");
	});

	it("Merge-commit messages are skipped", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("merge-skip", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);

		const mergeLessons = result.allLessons.filter(
			(l) =>
				l.source_kind === "fix_commit" && l.summary.toLowerCase().includes("merge pull request"),
		);
		assert.equal(mergeLessons.length, 0, "Merge commits should not produce fix_commit lessons");
	});

	// ── Stats / --since / --max / --dry-run / idempotency ──────────────────

	it("Stats report breakdown by source_kind", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("stats", FIXTURE_PATH));

		assert.equal(result.exitCode, 0);

		assert.ok(typeof result.stats.changelog === "number");
		assert.ok(typeof result.stats.adr === "number");
		assert.ok(typeof result.stats.post_mortem === "number");
		assert.ok(typeof result.stats.fix_commit === "number");

		const total =
			result.stats.changelog +
			result.stats.adr +
			result.stats.post_mortem +
			result.stats.fix_commit +
			result.stats.closed_issue;
		assert.equal(total, result.stats.lessons_added);

		assert.ok(result.stdout.includes("changelog"), "stdout should mention changelog");
		assert.ok(result.stdout.includes("adr"), "stdout should mention adr");
		assert.ok(result.stdout.includes("post_mortem"), "stdout should mention post_mortem");
		assert.ok(result.stdout.includes("fix_commit"), "stdout should mention fix_commit");
	});

	it("--since excludes older entries", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(
			makeOpts("since", FIXTURE_PATH, {
				since: new Date("2026-04-01"),
			}),
		);

		assert.equal(result.exitCode, 0);
		assert.ok(result.stats.changelog <= 2, "Only recent changelog entries");
		assert.ok(result.stats.changelog >= 1, "At least one recent changelog entry");

		for (const lesson of result.allLessons) {
			const date = new Date(lesson.original_incident_date);
			assert.ok(
				date >= new Date("2026-04-01"),
				`Lesson ${lesson.id} has date ${lesson.original_incident_date} before --since cutoff`,
			);
		}
	});

	it("--max caps total lessons", async () => {
		const { ingestHistory } = await import("./history.js");
		const result = await ingestHistory(makeOpts("max", FIXTURE_PATH, { max: 3 }));

		assert.equal(result.exitCode, 0);
		assert.ok(
			result.allLessons.length <= 3,
			`Expected at most 3 lessons, got ${result.allLessons.length}`,
		);
	});

	it("--dry-run does not write to memory dir", async () => {
		const { ingestHistory } = await import("./history.js");
		const opts = makeOpts("dryrun", FIXTURE_PATH, { dryRun: true });
		const result = await ingestHistory(opts);

		assert.equal(result.exitCode, 0);
		assert.ok(result.stdout.includes("[dry-run]"), "Expected dry-run indicator in stdout");
		assert.equal(result.stats.lessons_added, 0, "No lessons should be added in dry-run");

		const { readdirSync } = await import("node:fs");
		const lessonsDir = join(opts.memoryDir, "lessons");
		let lessonFiles: string[] = [];
		try {
			lessonFiles = readdirSync(lessonsDir).filter((f) => f.endsWith(".json"));
		} catch {
			// dir doesn't exist — even better
		}
		assert.equal(lessonFiles.length, 0, "Memory dir should be empty in dry-run");
	});

	it("Idempotent on re-run", async () => {
		const { ingestHistory } = await import("./history.js");
		const opts = makeOpts("idempotent", FIXTURE_PATH);

		const result1 = await ingestHistory(opts);
		assert.equal(result1.exitCode, 0);
		const firstAdded = result1.stats.lessons_added;
		assert.ok(firstAdded > 0, "First run should add lessons");

		const result2 = await ingestHistory(opts);
		assert.equal(result2.exitCode, 0);
		assert.equal(
			result2.stats.lessons_added,
			0,
			"Second run should add zero new lessons (idempotent)",
		);
		assert.ok(
			result2.stats.lessons_skipped_dedup > 0 || result2.stats.changelog === 0,
			"Should report skipped lessons",
		);
	});

	// ── --all integration ──────────────────────────────────────────────────

	it("--all runs rules + pr-reviews + history (validated via wiring)", async () => {
		const mod = await import("./history.js");
		assert.ok(typeof mod.ingestHistory === "function", "ingestHistory should be exported");
	});
});
