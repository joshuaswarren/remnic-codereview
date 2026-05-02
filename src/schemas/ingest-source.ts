// IngestSource schema — discriminated union with one variant per source_kind.
// Carries the raw payload before extraction into a Lesson.

import { z } from "zod";

/** Base fields shared across all PR-review surfaces. */
const prBaseFields = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	pr_number: z.number().int().positive(),
	body: z.string(),
	html_url: z.string().min(1),
});

/** Rules document source — a section extracted from CLAUDE.md / AGENTS.md / CONTRIBUTING.md. */
const rulesDocSource = z.object({
	type: z.literal("rules_doc"),
	repo_path: z.string().min(1),
	file_path: z.string().min(1),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Overall PR review (APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED). */
const prReviewOverallSource = prBaseFields.extend({
	type: z.literal("pr_review_overall"),
	pull_request_review_id: z.number().int(),
	state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]),
	reviewer: z.string().min(1),
	submitted_at: z.string().min(1),
});

/** Inline / file-level review comment on a PR. */
const prReviewInlineSource = prBaseFields.extend({
	type: z.literal("pr_review_inline"),
	comment_id: z.number().int(),
	file_path: z.string().min(1),
	original_line: z.number().int().nullable().optional(),
	line: z.number().int().nullable().optional(),
	original_start_line: z.number().int().nullable().optional(),
	start_line: z.number().int().nullable().optional(),
	diff_hunk: z.string(),
	commit_id: z.string().min(1),
	position: z.number().int().nullable().optional(),
	original_position: z.number().int().nullable().optional(),
	side: z.enum(["LEFT", "RIGHT"]).optional(),
	start_side: z.enum(["LEFT", "RIGHT"]).optional(),
	pull_request_review_id: z.number().int().nullable().optional(),
	parent_comment_id: z.number().int().nullable().optional(),
	reviewer: z.string().min(1),
	created_at: z.string().min(1),
	updated_at: z.string().optional(),
});

/** Threaded reply to an inline review comment. */
const prReviewReplySource = prBaseFields.extend({
	type: z.literal("pr_review_reply"),
	comment_id: z.number().int(),
	file_path: z.string().optional(),
	diff_hunk: z.string().optional(),
	commit_id: z.string().optional(),
	parent_comment_id: z.number().int(),
	reviewer: z.string().min(1),
	created_at: z.string().min(1),
});

/** Issue-style PR comment (the Conversation tab). */
const prDiscussionSource = z.object({
	type: z.literal("pr_discussion"),
	owner: z.string().min(1),
	repo: z.string().min(1),
	pr_number: z.number().int().positive(),
	comment_id: z.number().int(),
	commenter: z.string().min(1),
	body: z.string(),
	created_at: z.string().min(1),
	html_url: z.string().min(1),
});

/** CHANGELOG entry source. */
const changelogSource = z.object({
	type: z.literal("changelog"),
	repo_path: z.string().min(1),
	file_path: z.string().min(1),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Architecture Decision Record source. */
const adrSource = z.object({
	type: z.literal("adr"),
	repo_path: z.string().min(1),
	file_path: z.string().min(1),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Post-mortem document source. */
const postMortemSource = z.object({
	type: z.literal("post_mortem"),
	repo_path: z.string().min(1),
	file_path: z.string().min(1),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Closed issue (bug/security) source. */
const closedIssueSource = z.object({
	type: z.literal("closed_issue"),
	repo_path: z.string().min(1),
	file_path: z.string(),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Fix/revert/bug commit source. */
const fixCommitSource = z.object({
	type: z.literal("fix_commit"),
	repo_path: z.string().min(1),
	file_path: z.string(),
	section_heading: z.string().optional(),
	content: z.string().min(1),
});

/** Discriminated union of all ingest source types. */
export const IngestSourceSchema = z.discriminatedUnion("type", [
	rulesDocSource,
	prReviewOverallSource,
	prReviewInlineSource,
	prReviewReplySource,
	prDiscussionSource,
	changelogSource,
	adrSource,
	postMortemSource,
	closedIssueSource,
	fixCommitSource,
]);

/** Inferred TypeScript type for IngestSource. */
export type IngestSource = z.infer<typeof IngestSourceSchema>;
