// Rules ingestion pipeline — walks CLAUDE.md, AGENTS.md, CONTRIBUTING.md in a
// given path. Splits by headings (## / ###), feeds each section through
// extractLessons(), stores via MemoryAdapter. Deduplicates on content hash.
// Reports stats (N added, M skipped) with per-file breakdown.
// Supports --dry-run, --memory-dir, --quality presets.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { QualityPreset } from "../cli.js";
import { info } from "../log.js";
import { MemoryAdapter } from "../memory/adapter.js";
import type { Config } from "../schemas/config.js";
import { extractLessons } from "./extraction.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Canonical rules file names to look for. */
const CANONICAL_FILES = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"] as const;

/** Minimum section length (characters) to be considered extractable. */
const MIN_SECTION_LENGTH = 20;

// ── Types ────────────────────────────────────────────────────────────────────

/** Options for the rules ingestion command. */
export interface IngestRulesOptions {
	/** Path to the directory containing rules files. */
	rulesPath: string;
	/** Memory directory to store lessons in. */
	memoryDir: string;
	/** Quality preset for model selection. */
	quality: QualityPreset;
	/** If true, report stats but don't write to memory. */
	dryRun: boolean;
}

/** Per-file breakdown of ingestion stats. */
export interface FileStats {
	/** Number of lessons added from this file. */
	added: number;
	/** Number of lessons skipped (duplicate) from this file. */
	skipped: number;
	/** Number of sections extracted from this file. */
	sections: number;
}

/** Result of the rules ingestion command. */
export interface IngestRulesResult {
	/** Process exit code (0 for success). */
	exitCode: number;
	/** Total lessons added. */
	added: number;
	/** Total lessons skipped (duplicates). */
	skipped: number;
	/** For dry-run: lessons that would be added. */
	wouldAdd: number;
	/** Human-readable stdout output. */
	stdout: string;
	/** Per-file breakdown. */
	byFile: Record<string, FileStats>;
}

/** A section extracted from a markdown file. */
interface MarkdownSection {
	/** The heading text (e.g. "Rule 1: Always use slice guard"). */
	heading: string;
	/** The body text (everything under the heading until the next heading). */
	body: string;
}

// ── Quality preset model overrides ───────────────────────────────────────────

/** Quality preset model configuration. */
const QUALITY_PRESETS: Record<string, { extraction: string; judge: string; embed: string }> = {
	default: {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	},
	high: {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-mini",
		embed: "text-embedding-3-large",
	},
	cheap: {
		extraction: "gpt-5.4-nano",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	},
};

// ── Markdown parsing ─────────────────────────────────────────────────────────

/**
 * Split a markdown file into sections by ## and ### headings.
 * Each section is { heading, body }.
 * The content before the first heading (if any) is discarded since it's
 * typically the file title or introduction.
 */
function splitByHeadings(content: string): MarkdownSection[] {
	const lines = content.split("\n");
	const sections: MarkdownSection[] = [];

	let currentHeading = "";
	let currentBody: string[] = [];

	for (const line of lines) {
		// Match ## or ### headings (at line start)
		const headingMatch = /^(#{2,3})\s+(.+)$/.exec(line);
		if (headingMatch) {
			// Save previous section if it has enough content
			const body = currentBody.join("\n").trim();
			if (currentHeading && body.length >= MIN_SECTION_LENGTH) {
				sections.push({ heading: currentHeading, body });
			}
			currentHeading = headingMatch[2]?.trim() ?? "";
			currentBody = [];
		} else {
			currentBody.push(line);
		}
	}

	// Save the last section
	const finalBody = currentBody.join("\n").trim();
	if (currentHeading && finalBody.length >= MIN_SECTION_LENGTH) {
		sections.push({ heading: currentHeading, body: finalBody });
	}

	return sections;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingest rules from a directory containing CLAUDE.md, AGENTS.md, and/or
 * CONTRIBUTING.md. Splits each file by headings, extracts lessons via
 * OpenAI, stores via MemoryAdapter. Deduplicates on content hash.
 *
 * @throws if rulesPath doesn't exist or isn't a directory
 */
export async function ingestRules(opts: IngestRulesOptions): Promise<IngestRulesResult> {
	const { rulesPath, memoryDir, quality, dryRun } = opts;

	// ── Validate input path ────────────────────────────────────────────

	if (!existsSync(rulesPath)) {
		throw new Error(`Path does not exist: "${rulesPath}"`);
	}

	const pathStat = statSync(rulesPath);
	if (!pathStat.isDirectory()) {
		throw new Error(
			`Path is not a directory: "${rulesPath}". Provide a directory containing CLAUDE.md, AGENTS.md, and/or CONTRIBUTING.md.`,
		);
	}

	// ── Build config ───────────────────────────────────────────────────

	const preset = QUALITY_PRESETS[quality] ??
		QUALITY_PRESETS.default ?? {
			extraction: "gpt-5.4-mini",
			judge: "gpt-5.4-nano",
			embed: "text-embedding-3-small",
		};

	const config: Config = {
		owner: "local",
		repo: "rules",
		memory_dir: memoryDir,
		model_defaults: {
			extraction: process.env.OPENAI_EXTRACTION_MODEL ?? preset.extraction,
			judge: process.env.OPENAI_JUDGE_MODEL ?? preset.judge,
			embed: process.env.OPENAI_EMBED_MODEL ?? preset.embed,
		},
		dry_run: dryRun,
		quality,
	};

	// ── Discover canonical files ───────────────────────────────────────

	const dirEntries = readdirSync(rulesPath);
	const foundFiles: string[] = [];

	for (const canonical of CANONICAL_FILES) {
		if (dirEntries.includes(canonical)) {
			foundFiles.push(canonical);
		}
	}

	if (foundFiles.length === 0) {
		info("No canonical rules files found", { path: rulesPath });
		return {
			exitCode: 0,
			added: 0,
			skipped: 0,
			wouldAdd: 0,
			stdout:
				"No canonical rules files found (CLAUDE.md, AGENTS.md, CONTRIBUTING.md). 0 lessons added, 0 skipped.",
			byFile: {},
		};
	}

	// ── Initialize adapter (unless dry-run) ────────────────────────────

	let adapter: MemoryAdapter | null = null;
	if (!dryRun) {
		adapter = await MemoryAdapter.fromConfig({
			memory_dir: memoryDir,
			owner: "local",
			repo: "rules",
		});
	}

	// ── Process each file ──────────────────────────────────────────────

	let totalAdded = 0;
	let totalSkipped = 0;
	let totalWouldAdd = 0;
	const byFile: Record<string, FileStats> = {};
	const stdoutLines: string[] = [];

	for (const fileName of foundFiles) {
		const filePath = join(rulesPath, fileName);
		const content = readFileSync(filePath, "utf-8");
		const sections = splitByHeadings(content);

		info(`Processing ${fileName}`, { sections: sections.length });

		let fileAdded = 0;
		let fileSkipped = 0;

		for (const section of sections) {
			// Create an IngestSource for this section
			const source = {
				type: "rules_doc" as const,
				repo_path: rulesPath,
				file_path: fileName,
				section_heading: section.heading,
				content: section.body,
			};

			// Extract lessons
			const lessons = await extractLessons(source, config);

			for (const lesson of lessons) {
				if (dryRun) {
					totalWouldAdd++;
					fileAdded++;
				} else if (adapter) {
					const result = await adapter.storeLesson(lesson);
					if (result.deduped) {
						fileSkipped++;
						totalSkipped++;
					} else {
						fileAdded++;
						totalAdded++;
					}
				}
			}
		}

		byFile[fileName] = {
			added: dryRun ? fileAdded : fileAdded,
			skipped: fileSkipped,
			sections: sections.length,
		};

		if (dryRun) {
			stdoutLines.push(`  ${fileName}: ${fileAdded} sections would produce ~${fileAdded} lessons`);
		} else {
			stdoutLines.push(
				`  ${fileName}: ${fileAdded} lessons added, ${fileSkipped} skipped (${sections.length} sections)`,
			);
		}
	}

	// ── Shutdown adapter ───────────────────────────────────────────────

	if (adapter) {
		await adapter.shutdown();
	}

	// ── Build output ───────────────────────────────────────────────────

	let summaryLine: string;
	if (dryRun) {
		summaryLine = `[dry-run] Would add ${totalWouldAdd} lessons, 0 skipped.`;
	} else {
		summaryLine = `${totalAdded} lessons added, ${totalSkipped} skipped.`;
	}

	const stdout = [summaryLine, ...stdoutLines].join("\n");

	info("Rules ingestion complete", { added: totalAdded, skipped: totalSkipped, dryRun });

	return {
		exitCode: 0,
		added: totalAdded,
		skipped: totalSkipped,
		wouldAdd: totalWouldAdd,
		stdout,
		byFile,
	};
}
