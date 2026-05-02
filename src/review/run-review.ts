// Review runner — orchestrates the five-step review pipeline.
// fetch-diff → chunk-hunks → recall → judge → compose → poster.

import type { QualityPreset } from "../cli.js";
import { QUALITY_PRESETS } from "../config.js";
import type { GitHubClient } from "../github/client.js";
import * as log from "../log.js";
import { MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import type { PostedReview } from "../schemas/posted-review.js";
import type { ReviewVerdict } from "../schemas/review-verdict.js";
import { chunkHunks } from "./chunk-hunks.js";
import { compose } from "./composer.js";
import { fetchDiff } from "./fetch-diff.js";
import { judge } from "./judge.js";
import { postReview, renderReview } from "./poster.js";
import { recall } from "./recall.js";

/** Options for the review pipeline. */
export interface ReviewOptions {
	owner: string;
	repo: string;
	prNumber: number;
	memoryDir: string;
	quality: QualityPreset;
	dryRun: boolean;
	target: string | undefined;
	threshold: number | undefined;
}

/** Result of running the review pipeline. */
export interface ReviewResult {
	/** PostedReview record (always created, even in dry-run). */
	review: PostedReview;
	/** Rendered review string for dry-run output. */
	rendered: string;
	/** Number of comments produced. */
	commentCount: number;
	/** Number of hunks processed. */
	hunkCount: number;
	/** Whether there were binary hunks that were skipped. */
	hadBinaryHunks: boolean;
}

/**
 * Run the full review pipeline.
 *
 * Steps:
 * 1. Fetch the unified diff from GitHub
 * 2. Chunk the diff into hunks
 * 3. For each hunk, recall relevant lessons from memory
 * 4. Judge each (hunk, candidate) pair
 * 5. Compose surviving verdicts into comments
 * 6. Post or render the review
 *
 * @param client - GitHub client with auth
 * @param opts - Review options
 * @returns ReviewResult with the review record and rendered output
 */
export async function runReview(client: GitHubClient, opts: ReviewOptions): Promise<ReviewResult> {
	const { owner, repo, prNumber, memoryDir, quality, dryRun, target, threshold = 0.6 } = opts;

	// The target repo for posting (may differ from the diff source)
	const targetParts = target?.split("/");
	const postOwner = targetParts?.[0] ?? owner;
	const postRepo = targetParts?.[1] ?? repo;

	// Get the quality preset's model and top-K
	const preset = QUALITY_PRESETS[quality] ?? {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	};
	const judgeModel = preset.judge;
	const topK = quality === "high" ? 10 : quality === "cheap" ? 3 : 6;

	// Step 1: Fetch diff
	const diff = await fetchDiff(client, owner, repo, prNumber);

	// Step 2: Chunk into hunks
	const hunks = chunkHunks(diff);
	const hadBinaryHunks = diff.includes("Binary files") && hunks.length === 0;

	if (hunks.length === 0) {
		const message = hadBinaryHunks
			? "binary diff — no text hunks to review"
			: "no diff hunks found";
		log.info("review_no_hunks", { owner, repo, prNumber, reason: message });

		const review: PostedReview = {
			id: `rev_${Date.now()}`,
			owner: postOwner,
			repo: postRepo,
			pr_number: prNumber,
			posted_at: new Date().toISOString(),
			dry_run: dryRun,
			comments: [],
		};

		return {
			review,
			rendered: `${renderReview(review)}\nNote: ${message}`,
			commentCount: 0,
			hunkCount: 0,
			hadBinaryHunks,
		};
	}

	// Step 3: Initialize memory adapter
	const adapter = await MemoryAdapter.fromConfig({
		memory_dir: memoryDir,
		owner,
		repo,
	});

	try {
		// Step 3-4: Recall and judge
		const verdictInputs: Array<{
			file: string;
			line: number;
			lesson: Lesson;
			verdict: ReviewVerdict;
		}> = [];

		for (const hunk of hunks) {
			const hits = await recall(adapter, hunk, { topK });

			for (const hit of hits) {
				const verdict = await judge(hunk, hit.lesson, judgeModel);
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

		// Step 5: Compose
		const comments = compose(verdictInputs, { threshold });

		// Step 6: Post or render
		const review: PostedReview = {
			id: `rev_${Date.now()}`,
			owner: postOwner,
			repo: postRepo,
			pr_number: prNumber,
			posted_at: new Date().toISOString(),
			dry_run: dryRun,
			comments,
		};

		if (!dryRun && comments.length > 0) {
			await postReview(client, postOwner, postRepo, prNumber, comments, false);
		}

		// Store the review record (always, even in dry-run)
		await adapter.storeReview(review);

		const rendered = renderReview(review);

		return {
			review,
			rendered,
			commentCount: comments.length,
			hunkCount: hunks.length,
			hadBinaryHunks: false,
		};
	} finally {
		await adapter.shutdown();
	}
}
