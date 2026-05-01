// Tests for expandTilde() — Remnic Rule #17 compliance.

import * as assert from "node:assert/strict";
import { homedir } from "node:os";
import { describe, it } from "node:test";
import { expandTilde } from "./expand-tilde.js";

describe("expandTilde", () => {
	it("expands bare ~ to home directory", () => {
		assert.equal(expandTilde("~"), homedir());
	});

	it("expands ~/foo to home directory + /foo", () => {
		assert.equal(expandTilde("~/foo"), `${homedir()}/foo`);
	});

	it("expands ~/nested/path to home directory + /nested/path", () => {
		assert.equal(expandTilde("~/nested/path"), `${homedir()}/nested/path`);
	});

	it("does not modify absolute paths without tilde", () => {
		assert.equal(expandTilde("/tmp/foo"), "/tmp/foo");
	});

	it("does not modify relative paths without tilde", () => {
		assert.equal(expandTilde("foo/bar"), "foo/bar");
	});

	it("does not modify paths with tilde in the middle", () => {
		assert.equal(expandTilde("/foo~/bar"), "/foo~/bar");
	});

	it("does not modify paths with tilde at start but not followed by slash", () => {
		assert.equal(expandTilde("~otheruser"), "~otheruser");
	});

	it("handles empty string without error", () => {
		assert.equal(expandTilde(""), "");
	});

	it("expands ~/ with trailing slash", () => {
		assert.equal(expandTilde("~/"), `${homedir()}/`);
	});

	it("resolves .. in tilde paths correctly", () => {
		const result = expandTilde("~/foo/../bar");
		assert.ok(result.startsWith(homedir()));
		assert.ok(result.endsWith("bar"));
	});
});
