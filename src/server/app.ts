// Express app factory — JSON middleware, CORS localhost-only, routes, error handler.
// No auth in v1 (localhost only). JSON-only API under /api/*.

import express from "express";
import type { MemoryAdapter } from "../memory/adapter.js";
import { healthRouter } from "./routes/health.js";
import { lessonsRouter } from "./routes/lessons.js";
import { reviewsRouter } from "./routes/reviews.js";

/** Configuration for creating the Express app. */
export interface AppOptions {
	adapter: MemoryAdapter;
	version: string;
	modelDefaults: {
		extraction: string;
		judge: string;
		embed: string;
	};
}

/** Standard error response shape for all API errors. */
export interface ApiError {
	error: {
		code: string;
		message: string;
	};
}

/**
 * Create and configure the Express application.
 * - JSON body parsing
 * - CORS allow-list (localhost only)
 * - Route mounting under /api/*
 * - Centralized error handler
 */
export function createApp(opts: AppOptions): express.Express {
	const app = express();

	// ─── JSON middleware ───────────────────────────────────────────────────
	app.use(express.json({ type: "application/json" }));

	// ─── CORS middleware — localhost only ──────────────────────────────────
	app.use((req, res, next) => {
		const origin = req.headers.origin;

		if (origin) {
			const allowedPatterns = ["http://localhost", "http://127.0.0.1"];

			const isAllowed = allowedPatterns.some((pattern) => origin.startsWith(pattern));

			if (isAllowed) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
				res.setHeader("Access-Control-Allow-Headers", "Content-Type");
			}
			// If not allowed, we simply don't set CORS headers — browser will block
		}

		// Handle preflight
		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}

		next();
	});

	// ─── Routes ────────────────────────────────────────────────────────────
	app.use("/api/health", healthRouter(opts));
	app.use("/api/lessons", lessonsRouter(opts.adapter));
	app.use("/api/reviews", reviewsRouter(opts.adapter));

	// ─── 404 for unmatched /api/* routes ───────────────────────────────────
	app.use("/api", (_req, res) => {
		res.status(404).json({ error: { code: "NOT_FOUND", message: "API endpoint not found" } });
	});

	// ─── Centralized error handler ─────────────────────────────────────────
	app.use(
		(err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
			const status = (err as { status?: number }).status ?? 500;
			const code = status >= 400 && status < 500 ? "CLIENT_ERROR" : "INTERNAL_ERROR";

			res.status(status).json({
				error: {
					code,
					message: err.message || "An unexpected error occurred",
				},
			});
		},
	);

	return app;
}
