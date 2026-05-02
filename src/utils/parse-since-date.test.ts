// Tests for parseSinceDate — validates --since CLI flag values.
// Ensures NaN/Invalid Date values are rejected with a clear error (Remnic Rule #1).

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("parseSinceDate", () => {
	it("parses a valid ISO 8601 date string", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		const result = parseSinceDate("2026-04-15");
		assert.ok(result instanceof Date);
		assert.ok(!Number.isNaN(result.getTime()));
		// Date-only strings parse as UTC midnight
		assert.equal(result.toISOString().slice(0, 10), "2026-04-15");
	});

	it("parses a full ISO 8601 datetime string", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		const result = parseSinceDate("2026-04-15T10:30:00Z");
		assert.ok(result instanceof Date);
		assert.ok(!Number.isNaN(result.getTime()));
	});

	it("rejects 'not-a-date' with a clear error", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		assert.throws(() => parseSinceDate("not-a-date"), /not-a-date.*valid.*date/i);
	});

	it("rejects empty string with a clear error", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		assert.throws(() => parseSinceDate(""), /valid.*date/i);
	});

	it("rejects 'NaN' string with a clear error", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		assert.throws(() => parseSinceDate("NaN"), /NaN.*valid.*date/i);
	});

	it("rejects gibberish like 'abc123def' with a clear error", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		assert.throws(() => parseSinceDate("abc123def"), /valid.*date/i);
	});

	it("error message includes the invalid value and expected format", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		try {
			parseSinceDate("not-a-date");
			assert.fail("Should have thrown");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			assert.ok(
				message.includes("not-a-date"),
				`Error should mention the invalid value: ${message}`,
			);
			assert.ok(
				message.includes("ISO 8601") || message.includes("YYYY-MM-DD"),
				`Error should mention expected format: ${message}`,
			);
		}
	});

	it("accepts date-only format YYYY-MM-DD", async () => {
		const { parseSinceDate } = await import("./parse-since-date.js");
		const result = parseSinceDate("2026-01-01");
		assert.ok(result instanceof Date);
		assert.ok(!Number.isNaN(result.getTime()));
		assert.equal(result.toISOString().slice(0, 10), "2026-01-01");
	});
});
