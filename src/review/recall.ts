// Recall — hybrid search per hunk against the memory store.
// Queries the memory adapter with hunk text and file glob patterns.

import type { MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import type { Hunk } from "./chunk-hunks.js";

/** A candidate lesson matched to a hunk, with a relevance score. */
export interface RecallHit {
	lesson: Lesson;
	score: number;
}

/** Options for the recall step. */
export interface RecallOpts {
	/** Maximum number of candidates to return per hunk. */
	topK?: number;
}

/**
 * Search the memory store for lessons relevant to a hunk.
 *
 * Builds a query from the hunk text, file path glob, and surrounding context.
 * Returns the top-K candidates ranked by relevance score.
 */
export async function recall(
	adapter: MemoryAdapter,
	hunk: Hunk,
	opts?: RecallOpts,
): Promise<RecallHit[]> {
	const topK = opts?.topK ?? 6;

	// Build a query that combines different aspects of the hunk.
	// The memory adapter uses substring matching per token, so we need to
	// extract meaningful individual tokens from the hunk.
	const queryParts: string[] = [];

	// Add surrounding context (function/class names) — most specific
	if (hunk.surroundingContext) {
		queryParts.push(hunk.surroundingContext);
	}

	// Extract all identifier-like tokens from the hunk text
	// This includes function names, variable names, and language keywords
	const allTokens = hunk.hunkText.match(/[a-zA-Z_]\w{1,}/g) ?? [];
	const uniqueTokens = [...new Set(allTokens)];
	queryParts.push(...uniqueTokens);

	// Add the file path's basename (without extension) as context
	const basename =
		hunk.file
			.split("/")
			.pop()
			?.replace(/\.\w+$/, "") ?? "";
	if (basename.length >= 3) {
		queryParts.push(basename);
	}

	// Add the full hunk text for any exact substring matching
	queryParts.push(hunk.hunkText);

	const query = queryParts.join(" ");

	const hits = await adapter.searchLessons(query, { topK });

	return hits;
}
