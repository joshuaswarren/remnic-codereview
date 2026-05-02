// Judge — runs gpt-5.4-nano on each (hunk, candidate) pair to produce a
// structured ReviewVerdict. Supports OPENAI_JUDGE_STUB=1 for deterministic tests.

import type { Lesson } from "../schemas/lesson.js";
import type { ReviewVerdict } from "../schemas/review-verdict.js";
import type { Hunk } from "./chunk-hunks.js";

/**
 * Judge whether a lesson applies to a hunk of code under review.
 *
 * When OPENAI_JUDGE_STUB=1 is set, returns deterministic verdicts based on
 * keyword matching between the hunk text and the lesson's metadata. This
 * allows tests to run without hitting the OpenAI API.
 *
 * @param hunk - The diff hunk being reviewed
 * @param lesson - The candidate lesson from memory
 * @param model - The model to use (e.g. "gpt-5.4-nano")
 * @returns A structured ReviewVerdict
 */
export async function judge(hunk: Hunk, lesson: Lesson, model: string): Promise<ReviewVerdict> {
	if (process.env.OPENAI_JUDGE_STUB === "1") {
		return stubJudge(hunk, lesson);
	}

	// Real judge implementation using OpenAI Responses API
	const { getOpenAIClient } = await import("../openai/client.js");

	const client = getOpenAIClient();

	const systemPrompt = `You are a code review judge. Given a diff hunk and a past lesson,
determine whether the lesson applies to the changed code.
Return a structured verdict with:
- applies: boolean — whether the lesson is relevant
- confidence: number in [0, 1] — how confident you are
- severity: one of critical, high, medium, low, info
- suggested_change: string or null — a concrete fix if applies`;

	const userPrompt = `## Diff Hunk (file: ${hunk.file}, lines ${hunk.startLine}-${hunk.endLine})
\`\`\`
${hunk.hunkText}
\`\`\`

## Lesson
- Summary: ${lesson.summary}
- Tags: ${lesson.tags.join(", ")}
${lesson.pattern_keywords ? `- Pattern keywords: ${lesson.pattern_keywords.join(", ")}` : ""}
${lesson.what_to_check ? `- What to check: ${lesson.what_to_check}` : ""}
${lesson.suggested_fix_template ? `- Suggested fix: ${lesson.suggested_fix_template}` : ""}

Does this lesson apply to the diff hunk above?`;

	const response = await client.responses.create({
		model,
		input: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		],
		text: {
			format: {
				type: "json_schema",
				name: "review_verdict",
				schema: {
					type: "object",
					properties: {
						applies: { type: "boolean" },
						confidence: { type: "number" },
						severity: {
							type: "string",
							enum: ["critical", "high", "medium", "low", "info"],
						},
						suggested_change: { type: ["string", "null"] },
					},
					required: ["applies", "confidence", "severity", "suggested_change"],
					additionalProperties: false,
				},
				strict: true,
			},
		},
	});

	// Parse from output_text (output_parsed may not be available in all SDK versions)
	const text = response.output_text;
	if (text) {
		try {
			const obj = JSON.parse(text) as ReviewVerdict;
			return {
				applies: obj.applies,
				confidence: Math.max(0, Math.min(1, obj.confidence)),
				severity: obj.severity,
				suggested_change: obj.suggested_change,
			};
		} catch {
			// Fall through to default
		}
	}

	return { applies: false, confidence: 0, severity: "info", suggested_change: null };
}

/**
 * Deterministic stub judge for testing. Uses keyword matching between
 * the hunk text and lesson metadata to produce predictable verdicts.
 */
function stubJudge(hunk: Hunk, lesson: Lesson): ReviewVerdict {
	const hunkLower = hunk.hunkText.toLowerCase();

	// Primary check: pattern_keywords (most specific, e.g. "slice(-n)")
	const patternKeywords = (lesson.pattern_keywords ?? [])
		.filter(Boolean)
		.map((k) => k.toLowerCase());
	let matchCount = 0;

	for (const keyword of patternKeywords) {
		if (hunkLower.includes(keyword)) {
			matchCount += 2; // Weight pattern keywords higher
		}
	}

	// Secondary check: tags, but only use longer/more specific ones
	const specificTags = (lesson.tags ?? [])
		.filter((t) => t.length >= 4) // Skip short generic tags
		.map((t) => t.toLowerCase());

	for (const tag of specificTags) {
		if (hunkLower.includes(tag)) {
			matchCount += 1;
		}
	}

	// Tertiary check: summary and what_to_check as full phrases
	const phrases = [lesson.summary, lesson.what_to_check ?? ""]
		.filter((s) => s.length >= 10) // Only check meaningful phrases
		.map((s) => s.toLowerCase());

	for (const phrase of phrases) {
		// Check if any 3+ word subset of the phrase appears in the hunk
		const words = phrase.split(/\s+/).filter((w) => w.length >= 3);
		let wordMatches = 0;
		for (const word of words) {
			if (hunkLower.includes(word)) {
				wordMatches++;
			}
		}
		if (wordMatches >= 2) {
			matchCount += 1;
		}
	}

	// If insufficient keyword overlap, return not-applicable
	if (matchCount < 2) {
		return {
			applies: false,
			confidence: 0.1,
			severity: lesson.severity,
			suggested_change: null,
		};
	}

	// Scale confidence based on match count
	const confidence = Math.min(0.95, 0.5 + matchCount * 0.1);

	return {
		applies: true,
		confidence,
		severity: lesson.severity,
		suggested_change: lesson.suggested_fix_template ?? null,
	};
}
