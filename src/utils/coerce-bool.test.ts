// Tests for coerceBool() — Remnic Rule #24 compliance.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coerceBool } from "./coerce-bool.js";

describe("coerceBool", () => {
	describe("truthy values", () => {
		it('returns true for "true"', () => {
			assert.equal(coerceBool("true"), true);
		});

		it('returns true for "1"', () => {
			assert.equal(coerceBool("1"), true);
		});

		it('returns true for "yes"', () => {
			assert.equal(coerceBool("yes"), true);
		});

		it('returns true for "on"', () => {
			assert.equal(coerceBool("on"), true);
		});

		it("returns true for uppercase variants", () => {
			assert.equal(coerceBool("TRUE"), true);
			assert.equal(coerceBool("True"), true);
			assert.equal(coerceBool("YES"), true);
			assert.equal(coerceBool("ON"), true);
		});
	});

	describe("falsy values", () => {
		it('returns false for "false"', () => {
			assert.equal(coerceBool("false"), false);
		});

		it('returns false for "0"', () => {
			assert.equal(coerceBool("0"), false);
		});

		it('returns false for "no"', () => {
			assert.equal(coerceBool("no"), false);
		});

		it('returns false for "off"', () => {
			assert.equal(coerceBool("off"), false);
		});

		it("returns false for uppercase variants", () => {
			assert.equal(coerceBool("FALSE"), false);
			assert.equal(coerceBool("False"), false);
			assert.equal(coerceBool("NO"), false);
			assert.equal(coerceBool("OFF"), false);
		});
	});

	describe("whitespace handling", () => {
		it("trims whitespace before parsing", () => {
			assert.equal(coerceBool("  true  "), true);
			assert.equal(coerceBool(" false "), false);
		});
	});

	describe("invalid values", () => {
		it("throws on an unrecognized value", () => {
			assert.throws(() => coerceBool("maybe"), {
				message: /Invalid boolean value/,
			});
		});

		it("throws on empty string", () => {
			assert.throws(() => coerceBool(""), {
				message: /Invalid boolean value/,
			});
		});

		it("throws on random text", () => {
			assert.throws(() => coerceBool("banana"), {
				message: /Invalid boolean value/,
			});
		});

		it("includes the invalid value in the error message", () => {
			try {
				coerceBool("turbo");
				assert.fail("Expected an error");
			} catch (err: unknown) {
				assert.ok(err instanceof Error, "Expected an Error instance");
				assert.match((err as Error).message, /turbo/);
				assert.match((err as Error).message, /true.*false|Accepted values/i);
			}
		});
	});
});
