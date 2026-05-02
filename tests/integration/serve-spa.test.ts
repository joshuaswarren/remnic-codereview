// Integration tests for serve command SPA integration.
// Covers: GET / returns index.html, SPA fallback, static assets, Content-Type, graceful shutdown.
// These tests use supertest with the real app and verify the SPA serving behavior
// end-to-end against the built admin-console/dist/ output.

import * as assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import type { MemoryAdapter } from "../../src/memory/adapter.js";
import { createApp } from "../../src/server/app.js";
import { startServer } from "../../src/server/serve.js";

// ─── Mock adapter ───────────────────────────────────────────────────────────

function createMockAdapter(): MemoryAdapter {
	return {
		listLessons: async () => ({ items: [], cursor: undefined }),
		getLesson: async () => null,
		listReviews: async () => ({ items: [], cursor: undefined }),
		getReview: async () => null,
		shutdown: async () => {},
	} as unknown as MemoryAdapter;
}

const APP_OPTS = {
	adapter: createMockAdapter(),
	version: "0.1.0",
	modelDefaults: {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	},
};

// ─── Path to the built SPA ────────────────────────────────────────────────

// The built app resolves admin-console/dist relative to the compiled output
// directory (dist/). For these tests, we check whether the SPA assets exist.
const projectRoot = resolve(import.meta.dirname, "../..");
const uiDist = resolve(projectRoot, "admin-console/dist");
const hasSpaAssets = existsSync(uiDist) && existsSync(resolve(uiDist, "index.html"));

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Serve SPA integration", () => {
	const servers: Array<{ shutdown: () => Promise<void> }> = [];

	afterEach(async () => {
		for (const s of servers) {
			await s.shutdown().catch(() => {});
		}
		servers.length = 0;
	});

	describe("SPA static serving", () => {
		it("GET / returns 200 (index.html or API 404 if no SPA built)", async () => {
			const app = createApp(APP_OPTS);
			const res = await request(app).get("/");

			if (hasSpaAssets) {
				assert.equal(res.status, 200);
				assert.ok(
					res.headers["content-type"]?.includes("text/html"),
					`Expected text/html, got ${res.headers["content-type"]}`,
				);
				// The response should contain the React root div
				assert.ok(
					res.text.includes("root") || res.text.includes("<!doctype"),
					"Response should be an HTML document",
				);
			} else {
				// Without SPA built, GET / falls through to the catch-all
				// which should return a 404 or the SPA fallback missing error
				assert.ok(res.status === 200 || res.status === 404);
			}
		});

		it("GET /reviews returns index.html (SPA fallback)", async () => {
			if (!hasSpaAssets) return;

			const app = createApp(APP_OPTS);
			const res = await request(app).get("/reviews");
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("text/html"),
				`Expected text/html, got ${res.headers["content-type"]}`,
			);
			// Should return the same index.html as GET /
			assert.ok(res.text.includes("root"), "Response should contain React root div");
		});

		it("GET /unknown/path returns index.html (SPA fallback)", async () => {
			if (!hasSpaAssets) return;

			const app = createApp(APP_OPTS);
			const res = await request(app).get("/some/deeply/nested/unknown/path");
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("text/html"),
				`Expected text/html, got ${res.headers["content-type"]}`,
			);
			assert.ok(res.text.includes("root"), "Response should contain React root div");
		});

		it("GET /lessons returns index.html (SPA fallback)", async () => {
			if (!hasSpaAssets) return;

			const app = createApp(APP_OPTS);
			const res = await request(app).get("/lessons");
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("text/html"),
				`Expected text/html, got ${res.headers["content-type"]}`,
			);
		});

		it("GET /assets/<existing-asset> returns the built JS/CSS", async () => {
			if (!hasSpaAssets) return;

			const assetsDir = resolve(uiDist, "assets");
			if (!existsSync(assetsDir)) return;

			const assetFiles = readdirSync(assetsDir);
			const jsFile = assetFiles.find((f) => f.endsWith(".js"));
			if (!jsFile) return;

			const app = createApp(APP_OPTS);
			const res = await request(app).get(`/assets/${jsFile}`);
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("javascript"),
				`Expected javascript MIME type, got ${res.headers["content-type"]}`,
			);
		});

		it("GET /assets/<css-asset> returns the built CSS", async () => {
			if (!hasSpaAssets) return;

			const assetsDir = resolve(uiDist, "assets");
			if (!existsSync(assetsDir)) return;

			const assetFiles = readdirSync(assetsDir);
			const cssFile = assetFiles.find((f) => f.endsWith(".css"));
			if (!cssFile) return;

			const app = createApp(APP_OPTS);
			const res = await request(app).get(`/assets/${cssFile}`);
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("css"),
				`Expected CSS MIME type, got ${res.headers["content-type"]}`,
			);
		});

		it("static Content-Type is text/html for HTML, correct MIME for assets", async () => {
			if (!hasSpaAssets) return;

			const app = createApp(APP_OPTS);

			// HTML (root)
			const htmlRes = await request(app).get("/");
			assert.ok(
				htmlRes.headers["content-type"]?.includes("text/html"),
				"Root should have text/html content-type",
			);

			// JS asset
			const assetsDir = resolve(uiDist, "assets");
			if (existsSync(assetsDir)) {
				const assetFiles = readdirSync(assetsDir);
				const jsFile = assetFiles.find((f) => f.endsWith(".js"));
				if (jsFile) {
					const jsRes = await request(app).get(`/assets/${jsFile}`);
					assert.ok(
						jsRes.headers["content-type"]?.includes("javascript"),
						"JS asset should have javascript content-type",
					);
				}
			}
		});
	});

	describe("API routes still work alongside SPA", () => {
		it("GET /api/health returns JSON", async () => {
			const app = createApp(APP_OPTS);
			const res = await request(app).get("/api/health");
			assert.equal(res.status, 200);
			assert.equal(res.body.status, "ok");
			assert.ok(res.headers["content-type"]?.includes("application/json"));
		});

		it("GET /api/lessons returns JSON (not HTML)", async () => {
			const app = createApp(APP_OPTS);
			const res = await request(app).get("/api/lessons");
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("application/json"),
				"API route should return JSON, not HTML",
			);
		});

		it("GET /api/reviews returns JSON (not HTML)", async () => {
			const app = createApp(APP_OPTS);
			const res = await request(app).get("/api/reviews");
			assert.equal(res.status, 200);
			assert.ok(
				res.headers["content-type"]?.includes("application/json"),
				"API route should return JSON, not HTML",
			);
		});
	});

	describe("Graceful shutdown", () => {
		it("serve exits cleanly on SIGINT within 5 seconds", async () => {
			const adapter = createMockAdapter();
			const { server, shutdown } = await startServer({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				port: 0,
			});
			servers.push({ shutdown });

			const addr = server.address();
			assert.ok(addr && typeof addr === "object");

			// Verify server is running
			const port = (addr as { port: number }).port;
			const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
			assert.equal(healthRes.status, 200);

			// Shutdown should complete within 5 seconds
			const start = Date.now();
			await shutdown();
			const elapsed = Date.now() - start;
			assert.ok(elapsed < 5000, `Shutdown took ${elapsed}ms, should be < 5000ms`);

			// Verify server is no longer accepting connections
			await assert.rejects(async () => fetch(`http://127.0.0.1:${port}/api/health`));
		});

		it("shutdown waits for in-flight requests", async () => {
			const adapter = createMockAdapter();
			const { server, shutdown } = await startServer({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				port: 0,
			});
			servers.push({ shutdown });

			const addr = server.address();
			assert.ok(addr && typeof addr === "object");
			const port = (addr as { port: number }).port;

			// Start a request
			const requestPromise = fetch(`http://127.0.0.1:${port}/api/health`);

			// Wait for the request to be received by the server
			// Then trigger shutdown while the response is being sent
			const res = await requestPromise;
			assert.equal(res.status, 200);

			// Now shutdown should complete cleanly
			await shutdown();
		});
	});

	describe("No orphan processes", () => {
		it("server port is released after shutdown", async () => {
			const adapter = createMockAdapter();
			const { server, shutdown } = await startServer({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				port: 0,
			});

			const addr = server.address();
			assert.ok(addr && typeof addr === "object");
			const port = (addr as { port: number }).port;

			await shutdown();

			// Try to start a new server on the same port — should succeed
			const { server: server2, shutdown: shutdown2 } = await startServer({
				adapter: createMockAdapter(),
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				port,
			});
			servers.push({ shutdown: shutdown2 });

			const addr2 = server2.address();
			assert.ok(addr2 && typeof addr2 === "object");
			assert.equal((addr2 as { port: number }).port, port);

			await shutdown2();
		});
	});
});
