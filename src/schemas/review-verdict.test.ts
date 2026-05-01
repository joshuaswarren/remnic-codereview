// Tests for the ReviewVerdict Zod schema.
// TDD red — these should fail until review-verdict.ts is implemented.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("ReviewVerdict schema", () => {
	it("parses a valid verdict", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: true,
			confidence: 0.85,
			severity: "high",
			suggested_change: "Add a guard for n <= 0 before slice(-n)",
		};
		const result = ReviewVerdictSchema.parse(verdict);
		assert.equal(result.applies, true);
		assert.equal(result.confidence, 0.85);
		assert.equal(result.severity, "high");
		assert.equal(result.suggested_change, "Add a guard for n <= 0 before slice(-n)");
	});

	it("parses a verdict with applies=false and null suggested_change", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: false,
			confidence: 0.2,
			severity: "low",
			suggested_change: null,
		};
		const result = ReviewVerdictSchema.parse(verdict);
		assert.equal(result.applies, false);
		assert.equal(result.confidence, 0.2);
		assert.equal(result.severity, "low");
		assert.equal(result.suggested_change, null);
	});

	it("rejects confidence outside [0,1] — negative", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: true,
			confidence: -0.1,
			severity: "high",
			suggested_change: "fix",
		};
		assert.throws(() => ReviewVerdictSchema.parse(verdict));
	});

	it("rejects confidence outside [0,1] — greater than 1", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: true,
			confidence: 1.5,
			severity: "high",
			suggested_change: "fix",
		};
		assert.throws(() => ReviewVerdictSchema.parse(verdict));
	});

	it("accepts confidence at exact boundary 0", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: false,
			confidence: 0,
			severity: "info",
			suggested_change: null,
		};
		const result = ReviewVerdictSchema.parse(verdict);
		assert.equal(result.confidence, 0);
	});

	it("accepts confidence at exact boundary 1", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: true,
			confidence: 1,
			severity: "critical",
			suggested_change: "fix it",
		};
		const result = ReviewVerdictSchema.parse(verdict);
		assert.equal(result.confidence, 1);
	});

	it("rejects missing required field 'applies'", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			confidence: 0.5,
			severity: "medium",
			suggested_change: "fix",
		};
		assert.throws(() => ReviewVerdictSchema.parse(verdict));
	});

	it("rejects invalid severity value", async () => {
		const { ReviewVerdictSchema } = await import("./review-verdict.js");
		const verdict = {
			applies: true,
			confidence: 0.8,
			severity: "urgent",
			suggested_change: "fix",
		};
		assert.throws(() => ReviewVerdictSchema.parse(verdict));
	});

	it("exports the ReviewVerdictSchema", async () => {
		const mod = await import("./review-verdict.js");
		assert.ok(mod.ReviewVerdictSchema, "ReviewVerdictSchema is exported");
	});
});
