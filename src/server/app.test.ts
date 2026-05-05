// Tests for the Express server — app, routes, CORS, error handling.
// Covers: health, lessons (list + detail), reviews (list + detail),
// pagination, filtering, validation, CORS, 405, 404, graceful shutdown.

import * as assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import request from "supertest";
import type { GitHubClientLike } from "../ingest/pr-reviews.js";
import type { MemoryAdapter } from "../memory/adapter.js";
import type { Lesson } from "../schemas/lesson.js";
import type { PostedReview } from "../schemas/posted-review.js";
import { createApp } from "./app.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
	return {
		id: "les_test001",
		summary: "Test lesson: always use slice(-n) zero guard",
		severity: "high",
		source_kind: "rules_doc",
		source_url: "https://github.com/example/repo/blob/main/CLAUDE.md",
		original_incident_date: "2026-01-15T00:00:00Z",
		still_applies: true,
		tags: ["pattern-27", "safety"],
		...overrides,
	};
}

function makeReview(overrides: Partial<PostedReview> = {}): PostedReview {
	return {
		id: "rev_test001",
		owner: "acme",
		repo: "widgets",
		pr_number: 42,
		posted_at: "2026-04-20T12:00:00Z",
		dry_run: true,
		comments: [
			{
				path: "src/index.ts",
				line: 10,
				body: "Consider adding a zero guard before slice(-n).",
				citation: {
					lesson_id: "les_test001",
					source_kind: "rules_doc",
					source_url: "https://github.com/example/repo/blob/main/CLAUDE.md",
					original_date: "2026-01-15T00:00:00Z",
					confidence: 0.85,
				},
			},
		],
		...overrides,
	};
}

// ─── Mock adapter factory ─────────────────────────────────────────────────────

function createMockAdapter(lessons: Lesson[] = [], reviews: PostedReview[] = []): MemoryAdapter {
	const adapter = {
		listLessons: mock.fn(async (filter?: Record<string, unknown>) => {
			let filtered = [...lessons];

			// Apply severity filter (OR within, can be array)
			if (filter?.severity) {
				const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
				filtered = filtered.filter((l) => severities.includes(l.severity));
			}

			// Apply source_kind filter (OR within, can be array)
			if (filter?.source_kind) {
				const kinds = Array.isArray(filter.source_kind) ? filter.source_kind : [filter.source_kind];
				filtered = filtered.filter((l) => kinds.includes(l.source_kind));
			}

			// Apply tags filter (AND within)
			if (filter?.tags) {
				const requiredTags = Array.isArray(filter.tags) ? filter.tags : [filter.tags];
				filtered = filtered.filter((l) => requiredTags.every((t: string) => l.tags.includes(t)));
			}

			// Apply still_applies filter
			if (filter?.still_applies !== undefined) {
				filtered = filtered.filter((l) => l.still_applies === filter.still_applies);
			}

			// Apply text search
			if (filter?.q) {
				const q = String(filter.q).toLowerCase();
				filtered = filtered.filter(
					(l) =>
						l.summary.toLowerCase().includes(q) || l.tags.some((t) => t.toLowerCase().includes(q)),
				);
			}

			// Apply sort
			if (filter?.sort === "date") {
				filtered.sort(
					(a, b) =>
						new Date(b.original_incident_date).getTime() -
						new Date(a.original_incident_date).getTime(),
				);
			}

			// Cursor-based pagination
			const limit = (filter?.limit as number) ?? 25;
			const cursor = filter?.cursor as string | undefined;
			let startIndex = 0;
			if (cursor) {
				try {
					startIndex = Number.parseInt(Buffer.from(cursor, "base64").toString("utf-8"), 10);
				} catch {
					startIndex = 0;
				}
			}

			const items = filtered.slice(startIndex, startIndex + limit);
			const nextIndex = startIndex + items.length;
			const nextCursor =
				nextIndex < filtered.length ? Buffer.from(String(nextIndex)).toString("base64") : undefined;

			return { items, cursor: nextCursor };
		}),
		getLesson: mock.fn(async (id: string) => {
			return lessons.find((l) => l.id === id) ?? null;
		}),
		listReviews: mock.fn(async (filter?: Record<string, unknown>) => {
			const limit = (filter?.limit as number) ?? 25;
			const cursor = filter?.cursor as string | undefined;
			let startIndex = 0;
			if (cursor) {
				try {
					startIndex = Number.parseInt(Buffer.from(cursor, "base64").toString("utf-8"), 10);
				} catch {
					startIndex = 0;
				}
			}
			const items = reviews.slice(startIndex, startIndex + limit);
			const nextIndex = startIndex + items.length;
			const nextCursor =
				nextIndex < reviews.length ? Buffer.from(String(nextIndex)).toString("base64") : undefined;
			return { items, cursor: nextCursor };
		}),
		getReview: mock.fn(async (id: string) => {
			return reviews.find((r) => r.id === id) ?? null;
		}),
		shutdown: mock.fn(async () => {}),
	} as unknown as MemoryAdapter;

	return adapter;
}

interface TestGitHubClient extends GitHubClientLike {
	calls: {
		listReviews: number;
	};
}

function createMockGitHubClient(): TestGitHubClient {
	const client: TestGitHubClient = {
		calls: { listReviews: 0 },
		async listPRs() {
			return [];
		},
		async listReviews() {
			client.calls.listReviews++;
			return [
				{
					id: 1001,
					state: "COMMENTED",
					body: "Guard slice(-n) when count can be zero.",
					user: { login: "reviewer" },
					submitted_at: "2026-04-15T10:30:00Z",
					html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-1001",
				},
			];
		},
		async listReviewComments() {
			return [];
		},
		async listIssueComments() {
			return [];
		},
	};

	return client;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Express server", () => {
	const tmpDir = join("/tmp", `remnic-server-test-${Date.now()}`);

	before(() => {
		mkdirSync(tmpDir, { recursive: true });
	});

	after(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("GET /api/health", () => {
		it("returns 200 with status, version, model_defaults", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/health");
			assert.equal(res.status, 200);
			assert.equal(res.body.status, "ok");
			assert.equal(res.body.version, "0.1.0");
			assert.ok(res.body.model_defaults);
			assert.equal(res.body.model_defaults.extraction, "gpt-5.4-mini");
			assert.equal(res.body.model_defaults.judge, "gpt-5.4-nano");
			assert.equal(res.body.model_defaults.embed, "text-embedding-3-small");
		});

		it("returns JSON content-type", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/health");
			assert.ok(res.headers["content-type"]?.includes("application/json"));
		});
	});

	describe("GET /api/lessons", () => {
		it("returns empty list with no cursor when memory dir is empty", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons");
			assert.equal(res.status, 200);
			assert.deepEqual(res.body.items, []);
			assert.equal(res.body.cursor, undefined);
		});

		it("returns lessons from seeded memory dir", async () => {
			const lessons = [
				makeLesson({ id: "les_001" }),
				makeLesson({ id: "les_002", summary: "Second lesson", severity: "low" }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 2);
			assert.equal(res.body.items[0].id, "les_001");
		});

		it("defaults limit to 25", async () => {
			const lessons = Array.from({ length: 30 }, (_, i) =>
				makeLesson({ id: `les_${String(i).padStart(3, "0")}` }),
			);
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 25);
			assert.ok(res.body.cursor, "cursor should be present when more pages remain");
		});

		it("caps limit at 100 even when limit=200 is requested", async () => {
			const lessons = Array.from({ length: 150 }, (_, i) =>
				makeLesson({ id: `les_${String(i).padStart(3, "0")}` }),
			);
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?limit=200");
			assert.equal(res.status, 200);
			assert.ok(res.body.items.length <= 100);
		});

		it("cursor round-trips to the next page with no overlapping IDs", async () => {
			const lessons = Array.from({ length: 30 }, (_, i) =>
				makeLesson({ id: `les_${String(i).padStart(3, "0")}` }),
			);
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});

			const page1 = await request(app).get("/api/lessons?limit=10");
			assert.equal(page1.status, 200);
			assert.equal(page1.body.items.length, 10);
			assert.ok(page1.body.cursor);

			const page2 = await request(app).get(`/api/lessons?limit=10&cursor=${page1.body.cursor}`);
			assert.equal(page2.status, 200);
			assert.equal(page2.body.items.length, 10);

			const page1Ids = new Set(page1.body.items.map((i: { id: string }) => i.id));
			const page2Ids = new Set(page2.body.items.map((i: { id: string }) => i.id));
			for (const id of page2Ids) {
				assert.ok(!page1Ids.has(id), `Page 2 should not contain ID ${id} from page 1`);
			}
		});

		it("filters by severity (repeatable, OR)", async () => {
			const lessons = [
				makeLesson({ id: "les_001", severity: "critical" }),
				makeLesson({ id: "les_002", severity: "high" }),
				makeLesson({ id: "les_003", severity: "low" }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?severity=critical&severity=high");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 2);
			for (const item of res.body.items) {
				assert.ok(
					item.severity === "critical" || item.severity === "high",
					`Expected critical or high, got ${item.severity}`,
				);
			}
		});

		it("filters by source_kind (repeatable)", async () => {
			const lessons = [
				makeLesson({ id: "les_001", source_kind: "rules_doc" }),
				makeLesson({ id: "les_002", source_kind: "pr_review_inline" }),
				makeLesson({ id: "les_003", source_kind: "changelog" }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get(
				"/api/lessons?source_kind=rules_doc&source_kind=pr_review_inline",
			);
			assert.equal(res.status, 200);
			for (const item of res.body.items) {
				assert.ok(item.source_kind === "rules_doc" || item.source_kind === "pr_review_inline");
			}
		});

		it("filters by tags (repeatable, AND semantics)", async () => {
			const lessons = [
				makeLesson({ id: "les_001", tags: ["rule-29", "force-flush"] }),
				makeLesson({ id: "les_002", tags: ["rule-29"] }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?tags=rule-29&tags=force-flush");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 1);
			assert.equal(res.body.items[0].id, "les_001");
		});

		it("filters by still_applies=true", async () => {
			const lessons = [
				makeLesson({ id: "les_001", still_applies: true }),
				makeLesson({ id: "les_002", still_applies: false }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?still_applies=true");
			assert.equal(res.status, 200);
			for (const item of res.body.items) {
				assert.equal(item.still_applies, true);
			}
		});

		it("filters by still_applies=false (honors string 'false', not truthy)", async () => {
			const lessons = [
				makeLesson({ id: "les_001", still_applies: true }),
				makeLesson({ id: "les_002", still_applies: false }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?still_applies=false");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 1);
			assert.equal(res.body.items[0].still_applies, false);
		});

		it("sorts by date (descending) with sort=date", async () => {
			const lessons = [
				makeLesson({ id: "les_001", original_incident_date: "2026-01-01T00:00:00Z" }),
				makeLesson({ id: "les_002", original_incident_date: "2026-06-01T00:00:00Z" }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?sort=date");
			assert.equal(res.status, 200);
			assert.equal(res.body.items[0].id, "les_002");
		});

		it("rejects invalid severity with 400 and error shape", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?severity=fake");
			assert.equal(res.status, 400);
			assert.ok(res.body.error);
			assert.ok(res.body.error.code);
			assert.ok(res.body.error.message);
		});

		it("rejects invalid sort key with 400", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?sort=__not_a_sort__");
			assert.equal(res.status, 400);
			assert.ok(res.body.error);
		});

		it("rejects invalid still_applies value with 400", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?still_applies=maybe");
			assert.equal(res.status, 400);
		});

		it("rejects negative limit with 400", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?limit=-5");
			assert.equal(res.status, 400);
		});

		it("rejects non-numeric limit with 400", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?limit=abc");
			assert.equal(res.status, 400);
		});

		it("free-text search via q parameter narrows results", async () => {
			const lessons = [
				makeLesson({ id: "les_001", summary: "Frobnicate the widget" }),
				makeLesson({ id: "les_002", summary: "Unrelated lesson" }),
			];
			const adapter = createMockAdapter(lessons);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons?q=frobnicate");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 1);
			assert.equal(res.body.items[0].id, "les_001");
		});
	});

	describe("GET /api/lessons/:id", () => {
		it("returns the full lesson on hit", async () => {
			const lesson = makeLesson({ id: "les_001" });
			const adapter = createMockAdapter([lesson]);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons/les_001");
			assert.equal(res.status, 200);
			assert.equal(res.body.id, "les_001");
			assert.equal(res.body.summary, lesson.summary);
			assert.equal(res.body.severity, "high");
			assert.ok(res.body.tags);
			assert.equal(res.body.source_kind, "rules_doc");
		});

		it("returns 404 with error shape on miss", async () => {
			const adapter = createMockAdapter([]);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons/les_does_not_exist");
			assert.equal(res.status, 404);
			assert.ok(res.body.error);
			assert.ok(res.body.error.code);
			assert.ok(res.body.error.message);
		});
	});

	describe("GET /api/reviews", () => {
		it("returns empty list when no reviews exist", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/reviews");
			assert.equal(res.status, 200);
			assert.deepEqual(res.body.items, []);
		});

		it("returns reviews when they exist", async () => {
			const reviews = [makeReview({ id: "rev_001" }), makeReview({ id: "rev_002" })];
			const adapter = createMockAdapter([], reviews);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/reviews");
			assert.equal(res.status, 200);
			assert.equal(res.body.items.length, 2);
		});
	});

	describe("GET /api/reviews/:id", () => {
		it("returns the full review with comments on hit", async () => {
			const review = makeReview({ id: "rev_001" });
			const adapter = createMockAdapter([], [review]);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/reviews/rev_001");
			assert.equal(res.status, 200);
			assert.equal(res.body.id, "rev_001");
			assert.ok(Array.isArray(res.body.comments));
			assert.equal(res.body.comments.length, 1);
			assert.equal(res.body.comments[0].path, "src/index.ts");
		});

		it("returns 404 with error shape on miss", async () => {
			const adapter = createMockAdapter([], []);
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/reviews/rev_does_not_exist");
			assert.equal(res.status, 404);
			assert.ok(res.body.error);
		});
	});

	describe("CORS", () => {
		it("rejects non-localhost origins", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons").set("Origin", "http://evil.example");
			assert.notEqual(res.headers["access-control-allow-origin"], "http://evil.example");
			assert.notEqual(res.headers["access-control-allow-origin"], "*");
		});

		it("allows requests without Origin header", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/health");
			assert.equal(res.status, 200);
		});

		it("allows localhost origins", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).get("/api/lessons").set("Origin", "http://localhost:4317");
			assert.equal(res.status, 200);
		});
	});

	describe("POST /api/webhooks/github", () => {
		it("ingests a merged pull_request event into the memory store", async () => {
			const previousStub = process.env.OPENAI_JUDGE_STUB;
			process.env.OPENAI_JUDGE_STUB = "1";
			try {
				const memoryDir = join(tmpDir, `webhook-${Date.now()}`);
				const githubClient = createMockGitHubClient();
				const adapter = createMockAdapter();
				const app = createApp({
					adapter,
					version: "0.1.0",
					modelDefaults: {
						extraction: "gpt-5.4-mini",
						judge: "gpt-5.4-nano",
						embed: "text-embedding-3-small",
					},
					memoryDir,
					quality: "default",
					githubClient,
				});

				const res = await request(app)
					.post("/api/webhooks/github")
					.set("X-GitHub-Event", "pull_request")
					.send({
						action: "closed",
						repository: { full_name: "acme/widgets" },
						pull_request: {
							number: 42,
							title: "Fix storage bug",
							state: "closed",
							merged: true,
							merged_at: "2026-04-20T12:00:00Z",
							html_url: "https://github.com/acme/widgets/pull/42",
							user: { login: "author" },
							created_at: "2026-04-19T12:00:00Z",
							updated_at: "2026-04-20T12:00:00Z",
						},
					});

				assert.equal(res.status, 200);
				assert.equal(res.body.status, "ok");
				assert.equal(res.body.pr_number, 42);
				assert.equal(res.body.stats.prs_scanned, 1);
				assert.ok(res.body.stats.lessons_added >= 1);
				assert.equal(githubClient.calls.listReviews, 1);
			} finally {
				if (previousStub === undefined) {
					delete process.env.OPENAI_JUDGE_STUB;
				} else {
					process.env.OPENAI_JUDGE_STUB = previousStub;
				}
			}
		});

		it("ignores unmerged pull_request events", async () => {
			const githubClient = createMockGitHubClient();
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				memoryDir: join(tmpDir, `webhook-ignored-${Date.now()}`),
				githubClient,
			});

			const res = await request(app)
				.post("/api/webhooks/github")
				.set("X-GitHub-Event", "pull_request")
				.send({
					action: "closed",
					repository: { full_name: "acme/widgets" },
					pull_request: {
						number: 42,
						merged: false,
						merged_at: null,
					},
				});

			assert.equal(res.status, 202);
			assert.equal(res.body.status, "ignored");
			assert.equal(githubClient.calls.listReviews, 0);
		});
	});

	describe("Method not allowed", () => {
		it("POST /api/lessons returns 405", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).post("/api/lessons").send({});
			assert.equal(res.status, 405);
			assert.ok(res.body.error);
		});

		it("DELETE /api/lessons/:id returns 405", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).delete("/api/lessons/abc");
			assert.equal(res.status, 405);
		});

		it("PUT /api/lessons/:id returns 405", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});
			const res = await request(app).put("/api/lessons/abc").send({});
			assert.equal(res.status, 405);
		});
	});

	describe("Error shape for API routes", () => {
		it("all /api/* responses have JSON content-type", async () => {
			const adapter = createMockAdapter();
			const app = createApp({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
			});

			const healthRes = await request(app).get("/api/health");
			assert.ok(healthRes.headers["content-type"]?.includes("application/json"));

			const lessonsRes = await request(app).get("/api/lessons");
			assert.ok(lessonsRes.headers["content-type"]?.includes("application/json"));

			const notFoundRes = await request(app).get("/api/lessons/__missing__");
			assert.ok(notFoundRes.headers["content-type"]?.includes("application/json"));
		});
	});

	describe("serve.ts — startServer", () => {
		it("startServer returns a server that can be closed", async () => {
			const adapter = createMockAdapter();
			const { startServer } = await import("./serve.js");
			const { server, shutdown } = await startServer({
				adapter,
				version: "0.1.0",
				modelDefaults: {
					extraction: "gpt-5.4-mini",
					judge: "gpt-5.4-nano",
					embed: "text-embedding-3-small",
				},
				port: 0, // ephemeral port
			});
			assert.ok(server);
			const addr = server.address();
			assert.ok(addr && typeof addr === "object", "server should be listening");

			// Verify it's serving
			const port = (addr as { port: number }).port;
			const res = await fetch(`http://127.0.0.1:${port}/api/health`);
			assert.equal(res.status, 200);
			const body = await res.json();
			assert.equal(body.status, "ok");

			await shutdown();
		});
	});
});
