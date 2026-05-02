// Composer — assembles surviving verdicts into PostedComment[] with
// <oai-mem-citation> blocks. Deduplicates by (file, line, lesson_id).

import type { Lesson } from "../schemas/lesson.js";
import type { PostedComment } from "../schemas/posted-review.js";
import type { ReviewVerdict } from "../schemas/review-verdict.js";

/** Input to the composer: a surviving (file, line, lesson, verdict) tuple. */
export interface ComposerInput {
	file: string;
	line: number;
	lesson: Lesson;
	verdict: ReviewVerdict;
}

/** Options for the compose step. */
export interface ComposeOpts {
	/** Confidence threshold. Verdicts below this are excluded. Default: 0.6 */
	threshold?: number;
}

/** Citation block fields. */
export interface CitationData {
	lesson_id: string;
	source_kind: string;
	source_url: string;
	original_date: string;
	confidence: number;
}

/**
 * Format a citation block as the XML string appended to every comment body.
 *
 * The citation block is always the LAST element of the comment body.
 * Format:
 * ```xml
 * <oai-mem-citation>
 *   <field name="lesson_id">...</field>
 *   <field name="source_kind">...</field>
 *   <field name="source_url">...</field>
 *   <field name="original_date">...</field>
 *   <field name="confidence">...</field>
 * </oai-mem-citation>
 * ```
 */
export function formatCitationBlock(data: CitationData): string {
	return [
		"<oai-mem-citation>",
		`  <field name="lesson_id">${data.lesson_id}</field>`,
		`  <field name="source_kind">${data.source_kind}</field>`,
		`  <field name="source_url">${data.source_url}</field>`,
		`  <field name="original_date">${data.original_date}</field>`,
		`  <field name="confidence">${data.confidence.toFixed(2)}</field>`,
		"</oai-mem-citation>",
	].join("\n");
}

/**
 * Compose PostedComment[] from surviving verdicts.
 *
 * - Filters by confidence threshold (default 0.6)
 * - Deduplicates by (file, line, lesson_id) — same triple only produces one comment
 * - Each comment body ends with a <oai-mem-citation> block
 *
 * @param inputs - Array of (file, line, lesson, verdict) tuples from the judge step
 * @param opts - Options including confidence threshold
 * @returns Array of PostedComment objects ready for posting or rendering
 */
export function compose(inputs: ComposerInput[], opts?: ComposeOpts): PostedComment[] {
	const threshold = opts?.threshold ?? 0.6;

	// Filter by confidence threshold
	const filtered = inputs.filter((input) => input.verdict.confidence >= threshold);

	// Deduplicate by (file, line, lesson_id)
	const seen = new Set<string>();
	const unique: ComposerInput[] = [];

	for (const input of filtered) {
		const key = `${input.file}:${input.line}:${input.lesson.id}`;
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(input);
		}
	}

	// Build PostedComment for each unique input
	return unique.map((input) => {
		const citation: CitationData = {
			lesson_id: input.lesson.id,
			source_kind: input.lesson.source_kind,
			source_url: input.lesson.source_url,
			original_date: input.lesson.original_incident_date,
			confidence: input.verdict.confidence,
		};

		const bodyParts: string[] = [];

		// Summary line
		bodyParts.push(`**${input.lesson.summary}**`);
		bodyParts.push("");

		// Severity
		bodyParts.push(`Severity: \`${input.verdict.severity}\``);
		bodyParts.push("");

		// Suggested change if present
		if (input.verdict.suggested_change) {
			bodyParts.push("Suggested change:");
			bodyParts.push(`\`\`\`suggestion`);
			bodyParts.push(input.verdict.suggested_change);
			bodyParts.push(`\`\`\``);
			bodyParts.push("");
		}

		// Citation block — always LAST
		bodyParts.push(formatCitationBlock(citation));

		return {
			path: input.file,
			line: input.line,
			body: bodyParts.join("\n"),
			citation,
		};
	});
}
