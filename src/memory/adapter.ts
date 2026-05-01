// Memory adapter — thin wrapper around EngramAccessService from @remnic/core.
// One adapter per memoryDir. All methods accept explicit memoryDir via config.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { warn } from "../log.js";
import type { Lesson } from "../schemas/lesson.js";
import type { PostedReview } from "../schemas/posted-review.js";

/** Shape of the config needed to create an adapter. */
export interface AdapterConfig {
	memory_dir: string;
	owner: string;
	repo: string;
}

/** Options for search queries. */
export interface SearchOpts {
	topK?: number;
}

/** Filter for listing lessons. */
export interface LessonFilter {
	severity?: string;
	source_kind?: string;
	tags?: string[];
	still_applies?: boolean;
	limit?: number;
	cursor?: string;
}

/** Filter for listing reviews. */
export interface ReviewFilter {
	limit?: number;
	cursor?: string;
}

/** A search hit with score. */
export interface LessonHit {
	lesson: Lesson;
	score: number;
}

/** Result of storing a lesson. */
export interface StoreLessonResult {
	id: string;
	deduped: boolean;
}

/** Result of storing a review. */
export interface StoreReviewResult {
	id: string;
}

/** Paginated list result. */
export interface ListResult<T> {
	items: T[];
	cursor: string | undefined;
}

/** Internal representation of a stored lesson (with metadata). */
interface StoredLesson {
	lesson: Lesson;
	stored_at: string;
	content_hash: string;
}

/** Internal representation of a stored review. */
interface StoredReview {
	review: PostedReview;
	stored_at: string;
}

/**
 * Stable content hash for dedup. Sorts object keys before hashing
 * (Remnic Rule #38).
 */
function contentHash(lesson: Lesson): string {
	const normalized = {
		summary: lesson.summary,
		source_kind: lesson.source_kind,
		source_url: lesson.source_url,
		tags: [...lesson.tags].sort(),
	};
	const sorted = Object.keys(normalized)
		.sort()
		.map((k) => `${k}=${JSON.stringify((normalized as Record<string, unknown>)[k])}`)
		.join("&");
	return createHash("sha256").update(sorted).digest("hex").slice(0, 24);
}

/** Create directory if it doesn't exist. */
function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

/** Atomic write: write to temp file then rename (Remnic Rule #54). */
function atomicWrite(filePath: string, content: string): void {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

/**
 * MemoryAdapter — thin wrapper around @remnic/core EngramAccessService.
 *
 * Stores lessons as JSON files in the memory directory.
 * Maintains a content-hash index for dedup.
 * Search uses simple substring matching for now; full QMD integration
 * is wired through EngramAccessService when available.
 */
export class MemoryAdapter {
	private readonly lessonsDir: string;
	private readonly reviewsDir: string;
	private readonly contentHashMap: Map<string, string> = new Map();
	private readonly sourceHashMap: Map<string, string> = new Map();
	private readonly lessonIdToHash: Map<string, string> = new Map();
	private closed = false;

	private constructor(memoryDir: string) {
		this.lessonsDir = join(memoryDir, "lessons");
		this.reviewsDir = join(memoryDir, "reviews");
		ensureDir(this.lessonsDir);
		ensureDir(this.reviewsDir);
		this.loadExistingIndex();
	}

	/**
	 * Create a MemoryAdapter from a config object.
	 * Initializes the memory directory and loads any existing index.
	 */
	static async fromConfig(cfg: AdapterConfig): Promise<MemoryAdapter> {
		const adapter = new MemoryAdapter(cfg.memory_dir);
		return adapter;
	}

	/**
	 * Store a lesson. Returns {id, deduped}.
	 * Deduplicates on content hash of (summary, source_kind, source_url, tags).
	 * Source hash is stored for per-section dedup lookups but is NOT used
	 * for lesson-level dedup — that's handled at the section level before
	 * the LLM call.
	 */
	async storeLesson(lesson: Lesson): Promise<StoreLessonResult> {
		this.assertNotClosed();

		// Content-hash dedup (for lesson-level dedup)
		const hash = contentHash(lesson);
		const existingId = this.contentHashMap.get(hash);
		if (existingId !== undefined) {
			return { id: existingId, deduped: true };
		}

		// Store
		const id = lesson.id;
		const stored: StoredLesson = {
			lesson,
			stored_at: new Date().toISOString(),
			content_hash: hash,
		};
		const filePath = join(this.lessonsDir, `${id}.json`);
		atomicWrite(filePath, JSON.stringify(stored, null, 2));

		// Update indexes
		this.contentHashMap.set(hash, id);
		this.lessonIdToHash.set(id, hash);
		if (lesson.source_hash) {
			this.sourceHashMap.set(lesson.source_hash, id);
		}

		return { id, deduped: false };
	}

	/**
	 * Find a lesson by its source_hash. Returns the lesson ID or undefined.
	 * Used by rules ingestion for per-section skip-before-LLM-call.
	 */
	findBySourceHash(sourceHash: string): string | undefined {
		return this.sourceHashMap.get(sourceHash);
	}

	/**
	 * Search lessons by query text. Returns hits with scores.
	 * Uses substring matching against summary, tags, and source_url.
	 */
	async searchLessons(query: string, opts?: SearchOpts): Promise<LessonHit[]> {
		this.assertNotClosed();
		const topK = opts?.topK ?? 10;
		const queryLower = query.toLowerCase();
		const hits: LessonHit[] = [];

		const files = readdirSync(this.lessonsDir).filter((f) => f.endsWith(".json"));
		for (const file of files) {
			try {
				const raw = readFileSync(join(this.lessonsDir, file), "utf-8");
				const parsed = JSON.parse(raw) as StoredLesson;
				const lesson = parsed.lesson;

				// Simple scoring: count how many query terms match
				let score = 0;
				const searchFields = [
					lesson.summary,
					lesson.source_url,
					...(lesson.tags ?? []),
					...(lesson.pattern_keywords ?? []),
					lesson.what_to_check ?? "",
				].join(" ");

				// Tokenize query and check for matches
				const queryTerms = queryLower.split(/\s+/).filter(Boolean);
				const fieldLower = searchFields.toLowerCase();
				for (const term of queryTerms) {
					if (fieldLower.includes(term)) {
						score += 1;
					}
				}

				if (score > 0) {
					hits.push({ lesson, score });
				}
			} catch {
				warn("Failed to read lesson file", { file });
			}
		}

		// Sort by score descending
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, topK);
	}

	/**
	 * Get a single lesson by ID. Returns null if not found.
	 */
	async getLesson(id: string): Promise<Lesson | null> {
		this.assertNotClosed();
		const filePath = join(this.lessonsDir, `${id}.json`);
		try {
			const raw = readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw) as StoredLesson;
			return parsed.lesson;
		} catch {
			return null;
		}
	}

	/**
	 * List lessons with optional filtering and pagination.
	 * Cursor is based on the filtered set, not the full file set.
	 */
	async listLessons(filter?: LessonFilter): Promise<ListResult<Lesson>> {
		this.assertNotClosed();
		const limit = filter?.limit ?? 100;
		const cursor = filter?.cursor;

		const files = readdirSync(this.lessonsDir)
			.filter((f) => f.endsWith(".json"))
			.sort();

		// First pass: collect all lessons that match the filter
		const allFiltered: Lesson[] = [];
		for (const file of files) {
			try {
				const raw = readFileSync(join(this.lessonsDir, file), "utf-8");
				const parsed = JSON.parse(raw) as StoredLesson;
				const lesson = parsed.lesson;

				// Apply filters
				if (filter?.severity && lesson.severity !== filter.severity) continue;
				if (filter?.source_kind && lesson.source_kind !== filter.source_kind) continue;
				if (
					filter?.tags &&
					filter.tags.length > 0 &&
					!filter.tags.some((t) => lesson.tags.includes(t))
				)
					continue;
				if (filter?.still_applies !== undefined && lesson.still_applies !== filter.still_applies)
					continue;

				allFiltered.push(lesson);
			} catch {
				warn("Failed to read lesson file", { file });
			}
		}

		// Decode cursor (base64 of start index into the filtered set)
		let startIndex = 0;
		if (cursor !== undefined && cursor !== "") {
			try {
				startIndex = Number.parseInt(Buffer.from(cursor, "base64").toString("utf-8"), 10);
			} catch {
				startIndex = 0;
			}
		}

		// Slice the filtered set for the requested page
		const items = allFiltered.slice(startIndex, startIndex + limit);
		const nextIndex = startIndex + items.length;
		const hasMore = nextIndex < allFiltered.length;
		const nextCursor = hasMore ? Buffer.from(String(nextIndex)).toString("base64") : undefined;

		return { items, cursor: nextCursor };
	}

	/**
	 * Store a posted review. Returns {id}.
	 */
	async storeReview(review: PostedReview): Promise<StoreReviewResult> {
		this.assertNotClosed();
		const id = review.id;
		const stored: StoredReview = {
			review,
			stored_at: new Date().toISOString(),
		};
		const filePath = join(this.reviewsDir, `${id}.json`);
		atomicWrite(filePath, JSON.stringify(stored, null, 2));
		return { id };
	}

	/**
	 * List reviews with optional pagination.
	 */
	async listReviews(filter?: ReviewFilter): Promise<ListResult<PostedReview>> {
		this.assertNotClosed();
		const limit = filter?.limit ?? 100;
		const cursor = filter?.cursor;

		const files = readdirSync(this.reviewsDir)
			.filter((f) => f.endsWith(".json"))
			.sort()
			.reverse(); // newest first

		const reviews: PostedReview[] = [];
		let startIndex = 0;

		if (cursor !== undefined && cursor !== "") {
			try {
				startIndex = Number.parseInt(Buffer.from(cursor, "base64").toString("utf-8"), 10);
			} catch {
				startIndex = 0;
			}
		}

		for (let i = startIndex; i < files.length; i++) {
			if (reviews.length >= limit) break;
			const fileName = files[i];
			if (fileName === undefined) continue;

			try {
				const raw = readFileSync(join(this.reviewsDir, fileName), "utf-8");
				const parsed = JSON.parse(raw) as StoredReview;
				reviews.push(parsed.review);
			} catch {
				warn("Failed to read review file", { file: fileName });
			}
		}

		const nextIndex = startIndex + reviews.length;
		const hasMore = nextIndex < files.length;
		const nextCursor = hasMore ? Buffer.from(String(nextIndex)).toString("base64") : undefined;

		return { items: reviews, cursor: nextCursor };
	}

	/**
	 * Shut down the adapter. Flushes pending writes and releases resources.
	 */
	async shutdown(): Promise<void> {
		this.closed = true;
		// No background resources to flush in this implementation;
		// the EngramAccessService/Orchestrator integration would flush QMD here.
	}

	/** Load existing lesson files into the content-hash and source-hash indexes at startup. */
	private loadExistingIndex(): void {
		try {
			const files = readdirSync(this.lessonsDir).filter((f) => f.endsWith(".json"));
			for (const file of files) {
				try {
					const raw = readFileSync(join(this.lessonsDir, file), "utf-8");
					const parsed = JSON.parse(raw) as StoredLesson;
					const hash = parsed.content_hash;
					const id = parsed.lesson.id;
					this.contentHashMap.set(hash, id);
					this.lessonIdToHash.set(id, hash);
					if (parsed.lesson.source_hash) {
						this.sourceHashMap.set(parsed.lesson.source_hash, id);
					}
				} catch {
					warn("Failed to index existing lesson file", { file });
				}
			}
		} catch {
			// Directory may not exist yet — that's fine
		}
	}

	private assertNotClosed(): void {
		if (this.closed) {
			throw new Error("MemoryAdapter is shut down");
		}
	}
}
