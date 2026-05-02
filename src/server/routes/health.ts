// Health route — GET /api/health returns {status, version, model_defaults}.

import { Router } from "express";
import type { AppOptions } from "../app.js";

/** Create the health check router. */
export function healthRouter(opts: AppOptions): Router {
	const router = Router();

	router.get("/", (_req, res) => {
		res.json({
			status: "ok",
			version: opts.version,
			model_defaults: opts.modelDefaults,
		});
	});

	return router;
}
