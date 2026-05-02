// Reviews route — GET /api/reviews (paginated), GET /api/reviews/:id.
// Paginated list of PostedReview records.

import { Router } from "express";
import type { MemoryAdapter } from "../../memory/adapter.js";

/** Default page size for reviews. */
const DEFAULT_LIMIT = 25;

/** Maximum page size. */
const MAX_LIMIT = 100;

/** Create the reviews router. */
export function reviewsRouter(adapter: MemoryAdapter): Router {
	const router = Router();

	// GET /api/reviews — list reviews with pagination
	router.get("/", async (req, res) => {
		try {
			let limit = DEFAULT_LIMIT;
			if (req.query.limit !== undefined) {
				const parsed = Number(req.query.limit);
				if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
					res.status(400).json({
						error: {
							code: "VALIDATION_ERROR",
							message: `Invalid limit: "${req.query.limit}". Must be a non-negative integer.`,
						},
					});
					return;
				}
				limit = Math.min(parsed, MAX_LIMIT);
			}

			const cursor = req.query.cursor !== undefined ? String(req.query.cursor) : undefined;

			const filter: { limit: number; cursor?: string } = { limit };
			if (cursor !== undefined) {
				filter.cursor = cursor;
			}

			const result = await adapter.listReviews(filter);
			res.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal error";
			res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
		}
	});

	// GET /api/reviews/:id — single review detail with comments
	router.get("/:id", async (req, res) => {
		try {
			const review = await adapter.getReview(req.params.id);

			if (!review) {
				res.status(404).json({
					error: { code: "NOT_FOUND", message: `Review not found: ${req.params.id}` },
				});
				return;
			}
			res.json(review);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal error";
			res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
		}
	});

	return router;
}
