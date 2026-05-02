// Lesson schema — the rich shape for all ingested lessons.
// One Zod schema per file (Remnic convention).

import { z } from "zod";

/** Valid severity levels, ordered by urgency. */
export const Severity = z.enum(["critical", "high", "medium", "low", "info"]);

/** Valid source kinds — one per ingestion surface. */
export const SourceKind = z.enum([
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
]);

/** Lesson — the primary data shape stored in memory. */
export const LessonSchema = z.object({
	/** Unique lesson identifier (e.g. "les_01HX..."). */
	id: z.string().min(1),
	/** Human-readable one-line summary of the lesson. */
	summary: z.string().min(1),
	/** Severity level. */
	severity: Severity,
	/** How this lesson was ingested. */
	source_kind: SourceKind,
	/** URL or path pointing to the original source. */
	source_url: z.string().min(1),
	/** When the original incident was documented (ISO 8601). */
	original_incident_date: z.string().min(1),
	/** Whether this lesson is still relevant. */
	still_applies: z.boolean(),
	/** Free-form tags for categorization. */
	tags: z.array(z.string()),

	/** Optional: glob pattern for files this lesson applies to. */
	files_touched_glob: z.array(z.string()).optional(),
	/** Optional: keywords for pattern matching. */
	pattern_keywords: z.array(z.string()).optional(),
	/** Optional: what to check in code review. */
	what_to_check: z.string().optional(),
	/** Optional: template for suggested fix. */
	suggested_fix_template: z.string().optional(),
	/** Optional: related lesson IDs. */
	related_lessons: z.array(z.string()).optional(),
	/** Optional: code examples. */
	code_examples: z.array(z.string()).optional(),
	/**
	 * Hash of the source section content (file_path + heading + body).
	 * Used for per-section dedup: re-extracting the same section maps to the
	 * same lesson regardless of LLM non-determinism.
	 */
	source_hash: z.string().optional(),
	/**
	 * Source-specific metadata propagated from IngestSource through extraction.
	 * PR-review lessons carry fields like pull_request_review_id, state, reviewer,
	 * submitted_at, comment_id, file_path, line, diff_hunk, commit_id, position,
	 * side, is_outdated, parent_comment_id, html_url, created_at, updated_at, etc.
	 * Other source kinds may store their own domain-specific fields here.
	 */
	metadata: z.record(z.unknown()).optional(),
});

/** Inferred TypeScript type from the Lesson schema. */
export type Lesson = z.infer<typeof LessonSchema>;
