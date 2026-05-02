// Lessons route — GET /api/lessons (paginated, filterable), GET /api/lessons/:id.
// Filter params: q, severity (repeatable), source_kind (repeatable), tags (repeatable),
// still_applies, sort, cursor, limit (max 100, default 25).

import { Router } from "express";
import type { MemoryAdapter } from "../../memory/adapter.js";

/** Valid severity values. */
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

/** Valid source_kind values. */
const VALID_SOURCE_KINDS = new Set([
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

/** Valid sort keys. */
const VALID_SORTS = new Set(["date"]);

/** Default page size. */
const DEFAULT_LIMIT = 25;

/** Maximum page size. */
const MAX_LIMIT = 100;

/** Helper: create a validation error. */
function validationError(res: import("express").Response, message: string): void {
	res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
}

/** Create the lessons router. */
export function lessonsRouter(adapter: MemoryAdapter): Router {
	const router = Router();

	// GET /api/lessons — list with filtering and pagination
	router.get("/", async (req, res) => {
		try {
			// Parse limit
			let limit = DEFAULT_LIMIT;
			if (req.query.limit !== undefined) {
				const parsed = Number(req.query.limit);
				if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
					validationError(
						res,
						`Invalid limit: "${req.query.limit}". Must be a non-negative integer.`,
					);
					return;
				}
				limit = Math.min(parsed, MAX_LIMIT);
			}

			// Parse severity (repeatable)
			const severities = toArray(req.query.severity);
			for (const sev of severities) {
				if (!VALID_SEVERITIES.has(sev)) {
					validationError(
						res,
						`Invalid severity: "${sev}". Accepted values: ${[...VALID_SEVERITIES].join(", ")}.`,
					);
					return;
				}
			}

			// Parse source_kind (repeatable)
			const sourceKinds = toArray(req.query.source_kind);
			for (const sk of sourceKinds) {
				if (!VALID_SOURCE_KINDS.has(sk)) {
					validationError(
						res,
						`Invalid source_kind: "${sk}". Accepted values: ${[...VALID_SOURCE_KINDS].join(", ")}.`,
					);
					return;
				}
			}

			// Parse tags (repeatable)
			const tags = toArray(req.query.tags);

			// Parse still_applies
			let stillApplies: boolean | undefined;
			if (req.query.still_applies !== undefined) {
				const val = String(req.query.still_applies).toLowerCase();
				if (val === "true") {
					stillApplies = true;
				} else if (val === "false") {
					stillApplies = false;
				} else {
					validationError(
						res,
						`Invalid still_applies: "${req.query.still_applies}". Must be "true" or "false".`,
					);
					return;
				}
			}

			// Parse sort
			let sort: string | undefined;
			if (req.query.sort !== undefined) {
				sort = String(req.query.sort);
				if (!VALID_SORTS.has(sort)) {
					validationError(
						res,
						`Invalid sort: "${sort}". Accepted values: ${[...VALID_SORTS].join(", ")}.`,
					);
					return;
				}
			}

			// Parse cursor
			const cursor = req.query.cursor !== undefined ? String(req.query.cursor) : undefined;

			// Parse q (free-text search)
			const q = req.query.q !== undefined ? String(req.query.q) : undefined;

			// Build filter object for the adapter
			const filter: Record<string, unknown> = { limit };

			if (severities.length > 0) {
				filter.severity = severities;
			}
			if (sourceKinds.length > 0) {
				filter.source_kind = sourceKinds;
			}
			if (tags.length > 0) {
				filter.tags = tags;
			}
			if (stillApplies !== undefined) {
				filter.still_applies = stillApplies;
			}
			if (cursor) {
				filter.cursor = cursor;
			}
			if (sort) {
				filter.sort = sort;
			}
			if (q) {
				filter.q = q;
			}

			const result = await adapter.listLessons(filter as Parameters<typeof adapter.listLessons>[0]);
			res.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal error";
			res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
		}
	});

	// GET /api/lessons/:id — single lesson detail
	router.get("/:id", async (req, res) => {
		try {
			const lesson = await adapter.getLesson(req.params.id);
			if (!lesson) {
				res.status(404).json({
					error: { code: "NOT_FOUND", message: `Lesson not found: ${req.params.id}` },
				});
				return;
			}
			res.json(lesson);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal error";
			res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
		}
	});

	// Reject write methods on /api/lessons
	const writeMethods = ["post", "put", "delete", "patch"] as const;
	for (const method of writeMethods) {
		router[method]("/", (_req, res) => {
			res.status(405).json({
				error: {
					code: "METHOD_NOT_ALLOWED",
					message: `${method.toUpperCase()} is not allowed on /api/lessons`,
				},
			});
		});
		router[method]("/:id", (_req, res) => {
			res.status(405).json({
				error: {
					code: "METHOD_NOT_ALLOWED",
					message: `${method.toUpperCase()} is not allowed on /api/lessons/:id`,
				},
			});
		});
	}

	return router;
}

/** Convert a query param value to an array of strings. */
function toArray(value: unknown): string[] {
	if (value === undefined) return [];
	if (Array.isArray(value)) return value.map((v) => String(v));
	return [String(value)];
}
