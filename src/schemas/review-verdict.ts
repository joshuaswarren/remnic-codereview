// ReviewVerdict schema — what the judge returns for each (hunk, candidate) pair.

import { z } from "zod";

/** Verdict from the judge step: does this lesson apply to the hunk? */
export const ReviewVerdictSchema = z.object({
	/** Whether the lesson applies to the code under review. */
	applies: z.boolean(),
	/** Confidence score in [0, 1]. */
	confidence: z.number().min(0).max(1),
	/** Severity if the lesson applies. */
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	/** Suggested change to address the issue, or null if not applicable. */
	suggested_change: z.string().nullable(),
});

/** Inferred TypeScript type for ReviewVerdict. */
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
