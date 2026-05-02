// History ingestion — parses CHANGELOG, walks docs/adr/*.md and
// docs/post-mortems/*.md, fetches closed bug/security-labeled issues,
// scans git log for fix:/revert:/bug: commits.
// Each source produces Lessons with correct source_kind.
// Deduplicates on SHA-256 of normalized body + sorted tags.
// Supports --dry-run, --since, --max.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { QualityPreset } from "../cli.js";
import { info } from "../log.js";
import { MemoryAdapter } from "../memory/adapter.js";
import type { Config } from "../schemas/config.js";
import type { Lesson } from "../schemas/lesson.js";
import { extractLessons } from "./extraction.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Options for the history ingestion command. */
export interface IngestHistoryOptions {
	owner: string;
	repo: string;
	repoPath: string;
	memoryDir: string;
	quality: QualityPreset;
	dryRun: boolean;
	since: Date | undefined;
	max: number | undefined;
}

/** Per-source-kind stat counters. */
export interface HistoryStats {
	changelog: number;
	adr: number;
	post_mortem: number;
	closed_issue: number;
	fix_commit: number;
	lessons_added: number;
	lessons_skipped_dedup: number;
}

/** Result of the history ingestion. */
export interface IngestHistoryResult {
	exitCode: number;
	stats: HistoryStats;
	stdout: string;
	allLessons: Lesson[];
}

/** GitHub client interface for closed issues. */
export interface GitHubHistoryClient {
	listClosedIssues(owner: string, repo: string, labels?: string[]): Promise<Array<ClosedIssue>>;
}

/** Closed issue shape. */
export interface ClosedIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: Array<{ name: string }>;
	html_url: string;
	closed_at: string;
	user: { login: string } | null;
}

/** A parsed CHANGELOG entry. */
interface ChangelogEntry {
	version: string;
	date: string;
	sections: string[];
}

/** Shared mutable cap state for --max enforcement before persistence. */
interface CapState {
	addedCount: number;
	maxCap: number | undefined;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Quality preset model overrides. */
const QUALITY_PRESETS: Record<string, { extraction: string; judge: string; embed: string }> = {
	default: { extraction: "gpt-5.4-mini", judge: "gpt-5.4-nano", embed: "text-embedding-3-small" },
	high: { extraction: "gpt-5.4-mini", judge: "gpt-5.4-mini", embed: "text-embedding-3-large" },
	cheap: { extraction: "gpt-5.4-nano", judge: "gpt-5.4-nano", embed: "text-embedding-3-small" },
};

/** Minimum content length to be considered extractable. */
const MIN_CONTENT_LENGTH = 20;

/** Check if the --max cap has been reached. */
function capReached(cap: CapState): boolean {
	if (cap.maxCap === undefined || cap.maxCap <= 0) return false;
	return cap.addedCount >= cap.maxCap;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an empty stats object. */
function emptyStats(): HistoryStats {
	return {
		changelog: 0,
		adr: 0,
		post_mortem: 0,
		closed_issue: 0,
		fix_commit: 0,
		lessons_added: 0,
		lessons_skipped_dedup: 0,
	};
}

/** Build a Config for the extraction engine. */
function buildConfig(
	owner: string,
	repo: string,
	memoryDir: string,
	quality: QualityPreset,
	dryRun: boolean,
): Config {
	const preset = QUALITY_PRESETS[quality] ??
		QUALITY_PRESETS.default ?? {
			extraction: "gpt-5.4-mini",
			judge: "gpt-5.4-nano",
			embed: "text-embedding-3-small",
		};
	return {
		owner,
		repo,
		memory_dir: memoryDir,
		model_defaults: {
			extraction: process.env.OPENAI_EXTRACTION_MODEL ?? preset.extraction,
			judge: process.env.OPENAI_JUDGE_MODEL ?? preset.judge,
			embed: process.env.OPENAI_EMBED_MODEL ?? preset.embed,
		},
		dry_run: dryRun,
		quality,
	};
}

/** Check if a date is after the --since cutoff. */
function isAfterSince(dateStr: string, since: Date | undefined): boolean {
	if (!since) return true;
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return true;
	return date >= since;
}

/** Extract a date from various formats. */
function extractDate(text: string): string | null {
	// ISO date: 2026-04-15
	const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
	if (isoMatch?.[1]) return isoMatch[1];

	// Date in heading: [1.0.0] - 2026-01-01
	const bracketDate = /\[\d[^[\]]*\]\s*[-–]\s*(\d{4}-\d{2}-\d{2})/.exec(text);
	if (bracketDate?.[1]) return bracketDate[1];

	return null;
}

/** Extract date from ADR front-matter or body. */
function extractAdrDate(content: string, filePath: string): string {
	// Try YAML date: "Date: 2026-03-15"
	const dateMatch = /(?:^|\n)\s*(?:date|Date)\s*:\s*(\d{4}-\d{2}-\d{2})/.exec(content);
	if (dateMatch?.[1]) return dateMatch[1];

	// Try file stat mtime
	try {
		const stat = statSync(filePath);
		return stat.mtime.toISOString().slice(0, 10);
	} catch {
		return new Date().toISOString().slice(0, 10);
	}
}

// ── CHANGELOG parsing ────────────────────────────────────────────────────────

/**
 * Parse a CHANGELOG.md file into entries.
 * Recognizes semver headings like "## [2.0.0] - 2026-04-15" and
 * "## [2.0.0] (2026-04-15)".
 */
function parseChangelog(content: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	const lines = content.split("\n");

	let currentEntry: ChangelogEntry | null = null;

	for (const line of lines) {
		// Match semver headings: ## [version] - date or ## [version] (date)
		const headingMatch = /^##\s+\[([^\]]+)\]\s*[-–]?\s*(.*)/.exec(line);
		if (headingMatch) {
			// Save previous entry
			if (currentEntry?.sections.some((s) => s.trim().length >= MIN_CONTENT_LENGTH)) {
				entries.push(currentEntry);
			}

			const version = headingMatch[1] ?? "";
			const rest = headingMatch[2] ?? "";
			const date = extractDate(rest) ?? new Date().toISOString().slice(0, 10);
			currentEntry = { version, date, sections: [] };
			continue;
		}

		// Accumulate body text under current entry
		if (currentEntry) {
			currentEntry.sections.push(line);
		}
	}

	// Save the last entry
	if (currentEntry?.sections.some((s) => s.trim().length >= MIN_CONTENT_LENGTH)) {
		entries.push(currentEntry);
	}

	return entries;
}

// ── Source ingestion functions ────────────────────────────────────────────────

/** Ingest CHANGELOG entries. */
async function ingestChangelog(
	repoPath: string,
	config: Config,
	adapter: MemoryAdapter | null,
	dryRun: boolean,
	since: Date | undefined,
	stats: HistoryStats,
	allLessons: Lesson[],
	cap: CapState,
): Promise<void> {
	const changelogPath = join(repoPath, "CHANGELOG.md");
	if (!existsSync(changelogPath)) {
		info("No CHANGELOG.md found, skipping");
		return;
	}

	const content = readFileSync(changelogPath, "utf-8");
	const entries = parseChangelog(content);

	info("CHANGELOG entries found", { count: entries.length });

	for (const entry of entries) {
		if (capReached(cap)) return;
		// Apply --since filter
		if (!isAfterSince(entry.date, since)) continue;

		const body = entry.sections.join("\n").trim();
		if (body.length < MIN_CONTENT_LENGTH) continue;

		const source = {
			type: "changelog" as const,
			repo_path: repoPath,
			file_path: "CHANGELOG.md",
			section_heading: `[${entry.version}]`,
			content: body,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			if (capReached(cap)) return;
			lesson.source_kind = "changelog";
			lesson.source_url = `file://${join(repoPath, "CHANGELOG.md")}`;
			lesson.original_incident_date = entry.date;
			if (!lesson.tags.includes("changelog")) lesson.tags.push("changelog");

			stats.changelog++;

			if (dryRun) {
				allLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
					cap.addedCount++;
					allLessons.push(lesson);
				}
			}
		}
	}
}

/** Ingest ADR files from docs/adr/*.md. */
async function ingestAdrs(
	repoPath: string,
	config: Config,
	adapter: MemoryAdapter | null,
	dryRun: boolean,
	since: Date | undefined,
	stats: HistoryStats,
	allLessons: Lesson[],
	cap: CapState,
): Promise<void> {
	const adrDir = join(repoPath, "docs", "adr");
	if (!existsSync(adrDir)) {
		info("No docs/adr/ directory found, skipping ADRs");
		return;
	}

	const files = readdirSync(adrDir)
		.filter((f) => f.endsWith(".md"))
		.sort();

	info("ADR files found", { count: files.length });

	for (const fileName of files) {
		if (capReached(cap)) return;
		const filePath = join(adrDir, fileName);
		const content = readFileSync(filePath, "utf-8");

		// Extract date from front-matter or body
		const date = extractAdrDate(content, filePath);

		// Apply --since filter
		if (!isAfterSince(date, since)) continue;

		if (content.trim().length < MIN_CONTENT_LENGTH) continue;

		const source = {
			type: "adr" as const,
			repo_path: repoPath,
			file_path: `docs/adr/${fileName}`,
			section_heading: fileName,
			content,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			if (capReached(cap)) return;
			lesson.source_kind = "adr";
			lesson.source_url = `file://${filePath}`;
			lesson.original_incident_date = date;
			if (!lesson.tags.includes("adr")) lesson.tags.push("adr");

			stats.adr++;

			if (dryRun) {
				allLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
					cap.addedCount++;
					allLessons.push(lesson);
				}
			}
		}
	}
}

/** Ingest post-mortem files from docs/post-mortems/*.md. */
async function ingestPostMortems(
	repoPath: string,
	config: Config,
	adapter: MemoryAdapter | null,
	dryRun: boolean,
	since: Date | undefined,
	stats: HistoryStats,
	allLessons: Lesson[],
	cap: CapState,
): Promise<void> {
	const pmDir = join(repoPath, "docs", "post-mortems");
	if (!existsSync(pmDir)) {
		info("No docs/post-mortems/ directory found, skipping");
		return;
	}

	const files = readdirSync(pmDir)
		.filter((f) => f.endsWith(".md"))
		.sort();

	info("Post-mortem files found", { count: files.length });

	for (const fileName of files) {
		if (capReached(cap)) return;
		const filePath = join(pmDir, fileName);
		const content = readFileSync(filePath, "utf-8");

		// Extract date from body or filename
		const bodyDate = extractDate(content);
		const fileDate = extractDate(fileName);
		const date = bodyDate ?? fileDate ?? new Date().toISOString().slice(0, 10);

		// Apply --since filter
		if (!isAfterSince(date, since)) continue;

		if (content.trim().length < MIN_CONTENT_LENGTH) continue;

		const source = {
			type: "post_mortem" as const,
			repo_path: repoPath,
			file_path: `docs/post-mortems/${fileName}`,
			section_heading: fileName,
			content,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			if (capReached(cap)) return;
			lesson.source_kind = "post_mortem";
			lesson.source_url = `file://${filePath}`;
			lesson.original_incident_date = date;
			if (!lesson.tags.includes("post-mortem")) lesson.tags.push("post-mortem");

			stats.post_mortem++;

			if (dryRun) {
				allLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
					cap.addedCount++;
					allLessons.push(lesson);
				}
			}
		}
	}
}

/** Ingest closed issues from GitHub. */
async function ingestClosedIssues(
	owner: string,
	repo: string,
	ghClient: GitHubHistoryClient | undefined,
	config: Config,
	adapter: MemoryAdapter | null,
	dryRun: boolean,
	since: Date | undefined,
	stats: HistoryStats,
	allLessons: Lesson[],
	cap: CapState,
): Promise<void> {
	if (!ghClient) {
		info("No GitHub client provided, skipping closed issues");
		return;
	}

	// Fetch bug and security labeled issues
	const issues = await ghClient.listClosedIssues(owner, repo, ["bug", "security"]);

	info("Closed issues found", { count: issues.length });

	for (const issue of issues) {
		if (capReached(cap)) return;
		// Apply --since filter
		if (!isAfterSince(issue.closed_at, since)) continue;

		const body = issue.body ?? issue.title;
		const labels = issue.labels.map((l) => l.name);

		// Determine severity for security issues
		let severity: string | undefined;
		if (labels.includes("security")) {
			severity = "high";
		}

		const source = {
			type: "closed_issue" as const,
			repo_path: `${owner}/${repo}`,
			file_path: "",
			section_heading: `Issue #${issue.number}: ${issue.title}`,
			content: body,
		};

		const lessons = await extractLessons(source, config);

		for (const lesson of lessons) {
			if (capReached(cap)) return;
			lesson.source_kind = "closed_issue";
			lesson.source_url = issue.html_url;
			lesson.original_incident_date = issue.closed_at.slice(0, 10);

			// Add labels as tags
			for (const label of labels) {
				if (!lesson.tags.includes(label)) lesson.tags.push(label);
			}
			if (!lesson.tags.includes("closed-issue")) lesson.tags.push("closed-issue");

			// Override severity for security issues
			if (severity && !["critical", "high"].includes(lesson.severity)) {
				lesson.severity = severity as "critical" | "high" | "medium" | "low" | "info";
			}

			stats.closed_issue++;

			if (dryRun) {
				allLessons.push(lesson);
			} else if (adapter) {
				const result = await adapter.storeLesson(lesson);
				if (result.deduped) {
					stats.lessons_skipped_dedup++;
				} else {
					stats.lessons_added++;
					cap.addedCount++;
					allLessons.push(lesson);
				}
			}
		}
	}
}

/** Ingest fix:/revert:/bug: commits from git log. */
async function ingestGitCommits(
	repoPath: string,
	config: Config,
	adapter: MemoryAdapter | null,
	dryRun: boolean,
	since: Date | undefined,
	stats: HistoryStats,
	allLessons: Lesson[],
	cap: CapState,
): Promise<void> {
	if (!existsSync(join(repoPath, ".git"))) {
		info("No .git directory found, skipping git commits");
		return;
	}

	try {
		const git = simpleGit(repoPath);

		// Build log options
		const logOpts: string[] = ["--all"];
		if (since) {
			logOpts.push(`--since=${since.toISOString().slice(0, 10)}`);
		}

		const log = await git.log(logOpts);

		// Filter to fix:/revert:/bug: commits
		const fixCommits = log.all.filter((commit) => {
			const msg = commit.message.trim();
			// Skip merge commits
			if (msg.startsWith("Merge ")) return false;
			// Match fix:/revert:/bug: prefixes
			return /^(fix|revert|bug)\s*[:(]/i.test(msg);
		});

		info("Fix/revert/bug commits found", { count: fixCommits.length });

		for (const commit of fixCommits) {
			if (capReached(cap)) return;
			const msg = commit.message.trim();
			const date = commit.date.slice(0, 10);

			// Determine tags from commit prefix
			const tags: string[] = [];
			if (/^revert/i.test(msg)) {
				tags.push("revert");
			}
			if (/^bug\s*[:(]/i.test(msg)) {
				tags.push("bug");
			}
			if (/^fix\s*[:(]/i.test(msg)) {
				tags.push("fix");
			}

			const source = {
				type: "fix_commit" as const,
				repo_path: repoPath,
				file_path: "",
				section_heading: msg.split("\n")[0] ?? msg,
				content: msg,
			};

			const lessons = await extractLessons(source, config);

			for (const lesson of lessons) {
				if (capReached(cap)) return;
				lesson.source_kind = "fix_commit";
				lesson.source_url = commit.hash ?? "";
				lesson.original_incident_date = date;

				// Add commit-derived tags
				for (const tag of tags) {
					if (!lesson.tags.includes(tag)) lesson.tags.push(tag);
				}
				if (!lesson.tags.includes("fix-commit")) lesson.tags.push("fix-commit");

				stats.fix_commit++;

				if (dryRun) {
					allLessons.push(lesson);
				} else if (adapter) {
					const result = await adapter.storeLesson(lesson);
					if (result.deduped) {
						stats.lessons_skipped_dedup++;
					} else {
						stats.lessons_added++;
						cap.addedCount++;
						allLessons.push(lesson);
					}
				}
			}
		}
	} catch (err) {
		info("Git log scan failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingest history from a repository: CHANGELOG, ADRs, post-mortems,
 * closed bug/security issues, and fix:/revert:/bug: commits.
 *
 * Each source produces Lessons with the correct source_kind.
 * Deduplicates on SHA-256 of normalized body + sorted tags.
 *
 * @param opts - Ingestion options
 * @param ghClient - Optional GitHub client for closed issues (mock or real)
 */
export async function ingestHistory(
	opts: IngestHistoryOptions,
	ghClient?: GitHubHistoryClient,
): Promise<IngestHistoryResult> {
	const { owner, repo, repoPath, memoryDir, quality, dryRun, since, max } = opts;

	// ── Validate input path ────────────────────────────────────────────

	if (!existsSync(repoPath)) {
		throw new Error(`Path does not exist: "${repoPath}"`);
	}

	// ── Initialize ─────────────────────────────────────────────────────

	const stats = emptyStats();
	const allLessons: Lesson[] = [];
	const config = buildConfig(owner, repo, memoryDir, quality, dryRun);
	const cap: CapState = { addedCount: 0, maxCap: max };

	let adapter: MemoryAdapter | null = null;
	if (!dryRun) {
		adapter = await MemoryAdapter.fromConfig({ memory_dir: memoryDir, owner, repo });
	}

	// ── Run each source ────────────────────────────────────────────────

	// 1. CHANGELOG
	await ingestChangelog(repoPath, config, adapter, dryRun, since, stats, allLessons, cap);

	// 2. ADRs
	await ingestAdrs(repoPath, config, adapter, dryRun, since, stats, allLessons, cap);

	// 3. Post-mortems
	await ingestPostMortems(repoPath, config, adapter, dryRun, since, stats, allLessons, cap);

	// 4. Closed issues (requires GitHub client)
	await ingestClosedIssues(
		owner,
		repo,
		ghClient,
		config,
		adapter,
		dryRun,
		since,
		stats,
		allLessons,
		cap,
	);

	// 5. Git commits (fix:/revert:/bug:)
	await ingestGitCommits(repoPath, config, adapter, dryRun, since, stats, allLessons, cap);

	// ── Shutdown adapter ───────────────────────────────────────────────

	if (adapter) {
		await adapter.shutdown();
	}

	// ── Build output ───────────────────────────────────────────────────

	const stdoutLines: string[] = [];

	if (dryRun) {
		stdoutLines.push(
			`[dry-run] Would add ${allLessons.length} history lessons for ${owner}/${repo}.`,
		);
	} else {
		stdoutLines.push(
			`${stats.lessons_added} history lessons added, ${stats.lessons_skipped_dedup} skipped (dedup).`,
		);
	}

	stdoutLines.push(
		`  changelog: ${stats.changelog}`,
		`  adr: ${stats.adr}`,
		`  post_mortem: ${stats.post_mortem}`,
		`  closed_issue: ${stats.closed_issue}`,
		`  fix_commit: ${stats.fix_commit}`,
	);

	const stdout = stdoutLines.join("\n");

	info("History ingestion complete", { stats });

	return {
		exitCode: 0,
		stats,
		stdout,
		allLessons,
	};
}
