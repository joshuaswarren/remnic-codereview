// PostedReview + PostedComment schemas.
// Records of reviews the bot has submitted (or would submit in dry-run).

import { z } from "zod";

/** Citation block appended to every posted comment. */
const CitationBlockSchema = z.object({
	lesson_id: z.string().min(1),
	source_kind: z.string().min(1),
	source_url: z.string().min(1),
	original_date: z.string().min(1),
	confidence: z.number().min(0).max(1),
});

/** A single comment in a posted review. */
export const PostedCommentSchema = z.object({
	/** File path the comment applies to. */
	path: z.string().min(1),
	/** Line number the comment applies to. */
	line: z.number().int(),
	/** Full comment body including the citation block. */
	body: z.string().min(1),
	/** Structured citation data. */
	citation: CitationBlockSchema,
});

/** A posted review record. */
export const PostedReviewSchema = z.object({
	/** Unique review identifier. */
	id: z.string().min(1),
	/** Repository owner. */
	owner: z.string().min(1),
	/** Repository name. */
	repo: z.string().min(1),
	/** PR number. */
	pr_number: z.number().int(),
	/** ISO 8601 timestamp when the review was posted. */
	posted_at: z.string().min(1),
	/** Whether this was a dry-run (not actually posted to GitHub). */
	dry_run: z.boolean(),
	/** Comments in the review. */
	comments: z.array(PostedCommentSchema),
});

/** Inferred types. */
export type PostedReview = z.infer<typeof PostedReviewSchema>;
export type PostedComment = z.infer<typeof PostedCommentSchema>;
