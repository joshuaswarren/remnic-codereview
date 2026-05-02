// Poster — posts review via Octokit or renders for --dry-run.
// In dry-run mode, prints the rendered review without posting or storing.

import type { GitHubClient } from "../github/client.js";
import * as log from "../log.js";
import type { PostedComment, PostedReview } from "../schemas/posted-review.js";

/**
 * Post a review to GitHub (or skip in dry-run mode).
 *
 * @param client - GitHub client with auth
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @param comments - Comments to post
 * @param dryRun - If true, skip posting and just return
 * @returns The GitHub review result (or null in dry-run)
 */
export async function postReview(
	client: GitHubClient,
	owner: string,
	repo: string,
	prNumber: number,
	comments: PostedComment[],
	dryRun: boolean,
): Promise<{ id: number; html_url: string } | null> {
	if (dryRun) {
		log.info("dry_run_skip_post", { owner, repo, prNumber, comment_count: comments.length });
		return null;
	}

	if (comments.length === 0) {
		log.info("no_comments_to_post", { owner, repo, prNumber });
		return null;
	}

	// Determine review event: REQUEST_CHANGES if any high/critical severity, else COMMENT
	const hasHighSeverity = comments.some((c) => {
		// Check severity from citation confidence as a proxy —
		// the actual severity is in the body text
		return c.body.includes("Severity: `critical`") || c.body.includes("Severity: `high`");
	});

	const event = hasHighSeverity ? "REQUEST_CHANGES" : "COMMENT";
	const body = `Automated review by remnic-codereview (${comments.length} comment${comments.length !== 1 ? "s" : ""})`;

	const result = await client.postReview(owner, repo, prNumber, {
		event,
		body,
		comments: comments.map((c) => ({
			path: c.path,
			line: c.line,
			body: c.body,
		})),
	});

	log.info("review_posted", {
		owner,
		repo,
		prNumber,
		review_id: result.id,
		event,
		comment_count: comments.length,
	});

	return result;
}

/**
 * Render a PostedReview as a human-readable string for --dry-run output.
 */
export function renderReview(review: PostedReview): string {
	const lines: string[] = [];

	lines.push(`=== Review for ${review.owner}/${review.repo} PR #${review.pr_number} ===`);
	lines.push(`Posted: ${review.posted_at}`);
	lines.push(`Mode: ${review.dry_run ? "dry-run" : "live"}`);
	lines.push(`${review.comments.length} comment${review.comments.length !== 1 ? "s" : ""}`);
	lines.push("");

	if (review.comments.length === 0) {
		lines.push("No comments to post.");
	} else {
		for (const comment of review.comments) {
			lines.push(`--- ${comment.path}:${comment.line} ---`);
			lines.push(comment.body);
			lines.push("");
		}
	}

	return lines.join("\n");
}
