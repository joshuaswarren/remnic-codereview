// Lessons read commands — list and show subcommands for browsing stored lessons.
// `list` supports --filter (severity, source_kind, tags, still_applies), --sort
// (original_incident_date, hit_count, confidence), --json, --limit, --cursor.
// Renders paginated table by default; JSON when --json.
// `show <id>` renders full rich schema; exits non-zero on missing id.
// Both respect --memory-dir.

import { type LessonFilter, MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import { expandTilde } from "../utils/expand-tilde.js";

// ── Options Types ────────────────────────────────────────────────────────────

/** Options for the lessons list command. */
export interface LessonsListOptions {
	/** Memory directory override. */
	memoryDir: string;
	/** Output as JSON. */
	json?: boolean;
	/** Filter key-value pairs. */
	filter?: Record<string, string>;
	/** Sort field (e.g. "original_incident_date" or "original_incident_date:asc"). */
	sort?: string;
	/** Limit number of results. */
	limit?: number;
	/** Pagination cursor. */
	cursor?: string;
}

/** Options for the lessons show command. */
export interface LessonsShowOptions {
	/** Memory directory override. */
	memoryDir: string;
	/** Lesson ID to show. */
	lessonId: string;
	/** Output as JSON. */
	json?: boolean;
}

// ── Sort Helpers ─────────────────────────────────────────────────────────────

/** Parse a sort string into field and direction. */
function parseSortOption(sort?: string): { field: string; direction: "asc" | "desc" } | undefined {
	if (!sort) return undefined;
	const colonIdx = sort.indexOf(":");
	const field = colonIdx === -1 ? sort : sort.slice(0, colonIdx);
	const direction = colonIdx === -1 ? "desc" : sort.slice(colonIdx + 1);
	return { field, direction: direction === "asc" ? "asc" : "desc" };
}

/** Compare two lessons by a sort field. */
function compareLessons(a: Lesson, b: Lesson, field: string, direction: "asc" | "desc"): number {
	let cmp = 0;

	switch (field) {
		case "original_incident_date":
		case "date":
			cmp = a.original_incident_date.localeCompare(b.original_incident_date);
			break;
		case "hit_count":
		case "confidence":
			// These fields aren't stored on Lesson; fall back to stable sort by id
			cmp = a.id.localeCompare(b.id);
			break;
		default:
			cmp = a.id.localeCompare(b.id);
			break;
	}

	return direction === "asc" ? cmp : -cmp;
}

// ── Table Rendering ─────────────────────────────────────────────────────────

/** Render a lesson list as a human-readable table. */
function renderTable(lessons: Lesson[], total: number): string {
	const lines: string[] = [];

	// Header
	lines.push("ID                                 SEVERITY   SUMMARY");
	lines.push(
		"────────────────────────────────── ────────── ────────────────────────────────────────",
	);

	for (const lesson of lessons) {
		const id = lesson.id.padEnd(34);
		const severity = lesson.severity.padEnd(10);
		const summary =
			lesson.summary.length > 50 ? `${lesson.summary.slice(0, 47)}...` : lesson.summary.padEnd(50);
		lines.push(`${id} ${severity} ${summary}`);
	}

	lines.push("");
	lines.push(`Total: ${total} lesson${total !== 1 ? "s" : ""}`);

	return `${lines.join("\n")}\n`;
}

/** Render a single lesson as human-readable detail. */
function renderDetail(lesson: Lesson): string {
	const lines: string[] = [];

	lines.push(`ID:             ${lesson.id}`);
	lines.push(`Summary:        ${lesson.summary}`);
	lines.push(`Severity:       ${lesson.severity}`);
	lines.push(`Source Kind:    ${lesson.source_kind}`);
	lines.push(`Source URL:     ${lesson.source_url}`);
	lines.push(`Date:           ${lesson.original_incident_date}`);
	lines.push(`Still Applies:  ${lesson.still_applies}`);
	lines.push(`Tags:           ${lesson.tags.join(", ")}`);

	if (lesson.pattern_keywords && lesson.pattern_keywords.length > 0) {
		lines.push(`Keywords:       ${lesson.pattern_keywords.join(", ")}`);
	}
	if (lesson.what_to_check) {
		lines.push(`What to Check:  ${lesson.what_to_check}`);
	}
	if (lesson.suggested_fix_template) {
		lines.push(`Suggested Fix:  ${lesson.suggested_fix_template}`);
	}
	if (lesson.related_lessons && lesson.related_lessons.length > 0) {
		lines.push(`Related:        ${lesson.related_lessons.join(", ")}`);
	}
	if (lesson.code_examples && lesson.code_examples.length > 0) {
		lines.push(`Code Examples:`);
		for (const ex of lesson.code_examples) {
			lines.push(`  ${ex}`);
		}
	}
	if (lesson.files_touched_glob && lesson.files_touched_glob.length > 0) {
		lines.push(`File Globs:     ${lesson.files_touched_glob.join(", ")}`);
	}

	return `${lines.join("\n")}\n`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the lessons list command: query stored lessons with optional filtering,
 * sorting, and pagination. Renders a table by default or JSON with --json.
 * Returns a promise — callers (CLI wrapper) should .catch() and exit non-zero.
 *
 * When --sort is specified, all matching lessons are fetched (no adapter-level
 * limit), sorted globally, then sliced for the requested page. This ensures
 * --sort + --limit produces globally-sorted results instead of sorting a
 * pre-paginated subset.
 */
export async function runLessonsList(opts: LessonsListOptions): Promise<void> {
	const memoryDir = expandTilde(opts.memoryDir);

	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: memoryDir,
		owner: "local",
		repo: "lessons",
	});

	try {
		// Build filter
		const filter: LessonFilter = {};
		if (opts.filter) {
			if (opts.filter.severity) filter.severity = opts.filter.severity;
			if (opts.filter.source_kind) filter.source_kind = opts.filter.source_kind;
			if (opts.filter.tags) filter.tags = opts.filter.tags.split(",");
			if (opts.filter.still_applies !== undefined) {
				filter.still_applies = opts.filter.still_applies === "true";
			}
		}
		if (opts.cursor) filter.cursor = opts.cursor;

		// When sorting, fetch ALL matching lessons without a limit so we can
		// sort the full set before slicing for the requested page.
		const sortOpt = parseSortOption(opts.sort);
		if (sortOpt) {
			// Fetch all matching lessons (no limit at adapter level)
			const { items } = await adapter.listLessons(filter);

			// Apply sort to the full result set
			items.sort((a, b) => compareLessons(a, b, sortOpt.field, sortOpt.direction));

			// Slice for the requested page
			const limit = opts.limit ?? items.length;
			const sliced = items.slice(0, limit);
			const hasMore = items.length > limit;

			if (opts.json) {
				const output = {
					items: sliced,
					total: sliced.length,
					cursor: hasMore ? "has_more" : undefined,
				};
				process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
			} else if (sliced.length === 0) {
				process.stdout.write("No lessons found.\n");
			} else {
				process.stdout.write(renderTable(sliced, sliced.length));
			}
		} else {
			// No sort — use adapter-level pagination normally
			if (opts.limit) filter.limit = opts.limit;

			const { items, cursor } = await adapter.listLessons(filter);

			if (opts.json) {
				const output = { items, total: items.length, cursor };
				process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
			} else if (items.length === 0) {
				process.stdout.write("No lessons found.\n");
			} else {
				process.stdout.write(renderTable(items, items.length));
			}
		}
	} finally {
		await adapter.shutdown();
	}
}

/**
 * Run the lessons show command: render full detail for a single lesson.
 * Throws with "not found" message if the lesson ID doesn't exist.
 *
 * @throws Error if lesson is not found
 */
export async function runLessonsShow(opts: LessonsShowOptions): Promise<void> {
	const memoryDir = expandTilde(opts.memoryDir);

	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: memoryDir,
		owner: "local",
		repo: "lessons",
	});

	try {
		const lesson = await adapter.getLesson(opts.lessonId);
		if (!lesson) {
			throw new Error(`Lesson ${opts.lessonId} not found.`);
		}

		if (opts.json) {
			process.stdout.write(`${JSON.stringify(lesson, null, 2)}\n`);
		} else {
			process.stdout.write(renderDetail(lesson));
		}
	} finally {
		await adapter.shutdown();
	}
}
