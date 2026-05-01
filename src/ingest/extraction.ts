// Extraction engine — extracts Lessons from an IngestSource using OpenAI Responses API.
// Uses Structured Outputs (json_schema, strict: true, additionalProperties: false).
// Supports OPENAI_JUDGE_STUB=1 for deterministic test mode (canned lessons based on input hash).
// Retries API errors with exponential backoff (max 3 attempts).

import { createHash } from "node:crypto";
import { z } from "zod";
import { getOpenAIClient } from "../openai/client.js";
import type { Config } from "../schemas/config.js";
import type { IngestSource } from "../schemas/ingest-source.js";
import type { Lesson } from "../schemas/lesson.js";
import { LessonSchema } from "../schemas/lesson.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of retry attempts for transient API errors. */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = 1000;

/** Extraction prompt — instructs the model to extract lessons from source content. */
const EXTRACTION_SYSTEM_PROMPT = `You are a code-review lesson extractor. Given a source document or review comment, extract one or more actionable lessons that a code review bot can use to find similar issues in future pull requests.

For each lesson, provide:
- summary: A concise one-line description of the lesson
- severity: critical, high, medium, low, or info
- source_url: The URL or path to the original source
- original_incident_date: ISO 8601 date string (use today's date if unknown)
- still_applies: Whether this lesson is still relevant (default: true)
- tags: Array of relevant tags (e.g., "security", "performance", "style", "bug")
- pattern_keywords: Keywords that would match this pattern in code
- what_to_check: What to look for during code review
- suggested_fix_template: Template for fixing the issue
- code_examples: Relevant code examples if present in the source

Extract ONLY genuine, actionable lessons. Do not fabricate issues.`;

// ── Zod schema for structured output ─────────────────────────────────────────

/** Schema for a single extracted lesson (before ID assignment). */
const ExtractedLessonSchema = z.object({
	summary: z.string().min(1),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	source_url: z.string().min(1),
	original_incident_date: z.string().min(1),
	still_applies: z.boolean(),
	tags: z.array(z.string()),
	pattern_keywords: z.array(z.string()).optional(),
	what_to_check: z.string().optional(),
	suggested_fix_template: z.string().optional(),
	code_examples: z.array(z.string()).optional(),
});

/** Schema for the array of extracted lessons from the API response. */
const ExtractionResponseSchema = z.object({
	lessons: z.array(ExtractedLessonSchema),
});

// ── Stub mode ────────────────────────────────────────────────────────────────

/** Deterministic lesson generation for test mode (OPENAI_JUDGE_STUB=1). */
function stubExtractLessons(source: IngestSource, config: Config): Lesson[] {
	const raw = source.type === "rules_doc" ? source.content : JSON.stringify(source);
	const hash = createHash("sha256").update(raw).digest("hex");

	// Use hash to deterministically select severity
	const severityIndex = Number.parseInt(hash.slice(0, 8), 16) % 5;
	const severities = ["critical", "high", "medium", "low", "info"] as const;
	const severity = severities[severityIndex] ?? "medium";

	// Use hash to deterministically select still_applies
	const stillApplies = hash.charCodeAt(8) % 2 === 0;

	// Derive source_url from the source
	const sourceUrl =
		source.type === "rules_doc"
			? `${source.repo_path}/${source.file_path}`
			: "html_url" in source
				? (source as { html_url: string }).html_url
				: `${config.owner}/${config.repo}`;

	// Derive tags from source type
	const tags = [source.type.replace(/_/g, "-")];
	if (hash.charCodeAt(10) % 3 === 0) tags.push("best-practice");
	if (hash.charCodeAt(12) % 4 === 0) tags.push("security");

	// Generate a stable lesson ID from the content hash
	const id = `les_${hash.slice(0, 24)}`;

	const heading =
		source.type === "rules_doc" && "section_heading" in source
			? (source.section_heading ?? "General")
			: `Review comment in ${config.owner}/${config.repo}`;

	// Produce 1-2 lessons based on hash
	const count = (hash.charCodeAt(16) % 2) + 1;
	const lessons: Lesson[] = [];

	for (let i = 0; i < count; i++) {
		const suffix = i > 0 ? ` (variant ${i + 1})` : "";
		lessons.push({
			id: count > 1 ? `les_${hash.slice(0, 20)}_${i}` : id,
			summary:
				source.type === "rules_doc"
					? `${heading}: ${raw.slice(0, 80).trimEnd()}${suffix}`
					: `Lesson from ${source.type}: ${raw.slice(0, 60).trimEnd()}${suffix}`,
			severity,
			source_kind: source.type,
			source_url: sourceUrl,
			original_incident_date: new Date().toISOString().slice(0, 10),
			still_applies: stillApplies,
			tags: [...tags],
			pattern_keywords: [source.type],
			what_to_check: `Check for patterns related to: ${raw.slice(0, 50).trimEnd()}`,
		});
	}

	return lessons;
}

// ── Retry logic ──────────────────────────────────────────────────────────────

/** Sleep for the specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Determine if an error is retryable (rate limit, server error, timeout). */
function isRetryableError(err: unknown): boolean {
	if (err instanceof Error) {
		const msg = err.message.toLowerCase();
		// OpenAI SDK errors carry status codes
		if ("status" in err) {
			const status = (err as { status?: number }).status;
			if (status !== undefined && (status === 429 || status >= 500)) {
				return true;
			}
		}
		// Network / timeout errors
		if (
			msg.includes("rate limit") ||
			msg.includes("timeout") ||
			msg.includes("econnreset") ||
			msg.includes("econnrefused") ||
			msg.includes("500") ||
			msg.includes("502") ||
			msg.includes("503") ||
			msg.includes("504") ||
			msg.includes("429")
		) {
			return true;
		}
	}
	return false;
}

// ── Real API call ────────────────────────────────────────────────────────────

/** Call the OpenAI Responses API with structured outputs. */
async function callOpenAI(source: IngestSource, model: string): Promise<Lesson[]> {
	const client = getOpenAIClient();

	// Build the input text from the source
	const inputText =
		source.type === "rules_doc"
			? `Source file: ${source.file_path}\nSection: ${source.section_heading ?? "N/A"}\n\n${source.content}`
			: JSON.stringify(source, null, 2);

	// Build the JSON schema for structured output
	const jsonSchema = {
		type: "object" as const,
		properties: {
			lessons: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						summary: { type: "string" as const },
						severity: {
							type: "string" as const,
							enum: ["critical", "high", "medium", "low", "info"],
						},
						source_url: { type: "string" as const },
						original_incident_date: { type: "string" as const },
						still_applies: { type: "boolean" as const },
						tags: {
							type: "array" as const,
							items: { type: "string" as const },
						},
						pattern_keywords: {
							type: "array" as const,
							items: { type: "string" as const },
						},
						what_to_check: { type: "string" as const },
						suggested_fix_template: { type: "string" as const },
						code_examples: {
							type: "array" as const,
							items: { type: "string" as const },
						},
					},
					required: [
						"summary",
						"severity",
						"source_url",
						"original_incident_date",
						"still_applies",
						"tags",
					] as string[],
					additionalProperties: false,
				},
			},
		},
		required: ["lessons"] as string[],
		additionalProperties: false,
	};

	let lastError: Error | null = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const response = await client.responses.parse({
				model,
				input: [
					{ role: "system", content: EXTRACTION_SYSTEM_PROMPT },
					{ role: "user", content: inputText },
				],
				text: {
					format: {
						type: "json_schema",
						name: "extraction_response",
						schema: jsonSchema,
						strict: true,
					},
				},
			});

			const parsed = response.output_parsed;
			if (!parsed) {
				throw new Error("OpenAI returned no parsed output");
			}

			// Validate with Zod
			const validated = ExtractionResponseSchema.parse(parsed);

			// Convert extracted lessons to full Lesson objects with IDs
			const lessons: Lesson[] = validated.lessons.map((extracted, index) => {
				const contentHash = createHash("sha256")
					.update(`${source.type}:${JSON.stringify(extracted)}:${index}`)
					.digest("hex");

				return LessonSchema.parse({
					id: `les_${contentHash.slice(0, 24)}`,
					summary: extracted.summary,
					severity: extracted.severity,
					source_kind: source.type,
					source_url: extracted.source_url,
					original_incident_date: extracted.original_incident_date,
					still_applies: extracted.still_applies,
					tags: extracted.tags,
					pattern_keywords: extracted.pattern_keywords,
					what_to_check: extracted.what_to_check,
					suggested_fix_template: extracted.suggested_fix_template,
					code_examples: extracted.code_examples,
				});
			});

			return lessons;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			if (isRetryableError(err) && attempt < MAX_RETRIES - 1) {
				const delay = BASE_DELAY_MS * 2 ** attempt;
				await sleep(delay);
				continue;
			}

			// Non-retryable error or max retries exceeded
			if (!isRetryableError(err)) {
				throw lastError;
			}
		}
	}

	throw lastError ?? new Error("Extraction failed after max retries");
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Supported source types for extraction. */
const SUPPORTED_SOURCE_TYPES = new Set([
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

/**
 * Extract Lessons from a single IngestSource using the OpenAI Responses API.
 * One call per source produces 1..N Lessons.
 *
 * When OPENAI_JUDGE_STUB=1 is set, bypasses the real API and returns
 * deterministic canned lessons based on the input hash.
 *
 * Handles API errors with retry (max 3, exponential backoff).
 */
export async function extractLessons(source: IngestSource, config: Config): Promise<Lesson[]> {
	// Validate source type
	if (!SUPPORTED_SOURCE_TYPES.has(source.type)) {
		throw new Error(
			`Unsupported source type: "${source.type}". Supported types: ${[...SUPPORTED_SOURCE_TYPES].join(", ")}`,
		);
	}

	// Check for stub mode (deterministic test mode)
	if (process.env.OPENAI_JUDGE_STUB === "1") {
		return stubExtractLessons(source, config);
	}

	// Use the extraction model from config
	const model = config.model_defaults.extraction;
	return callOpenAI(source, model);
}
