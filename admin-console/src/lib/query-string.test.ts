// Unit tests for URL query string serialization helpers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtersToSearchParams, searchParamsToFilters } from "./query-string.js";
import type { LessonFilters } from "./api-types.js";

describe("filtersToSearchParams", () => {
  it("serializes empty filters to empty params", () => {
    const params = filtersToSearchParams({});
    assert.equal(params.toString(), "");
  });

  it("serializes q filter", () => {
    const params = filtersToSearchParams({ q: "slice" });
    assert.equal(params.get("q"), "slice");
  });

  it("serializes severity as repeated key", () => {
    const params = filtersToSearchParams({ severity: ["high", "medium"] });
    assert.deepEqual(params.getAll("severity"), ["high", "medium"]);
  });

  it("serializes source_kind as repeated key", () => {
    const params = filtersToSearchParams({ source_kind: ["rules_doc", "pr_review_inline"] });
    assert.deepEqual(params.getAll("source_kind"), ["rules_doc", "pr_review_inline"]);
  });

  it("serializes tags as repeated key", () => {
    const params = filtersToSearchParams({ tags: ["security", "pattern"] });
    assert.deepEqual(params.getAll("tags"), ["security", "pattern"]);
  });

  it("serializes still_applies true", () => {
    const params = filtersToSearchParams({ still_applies: true });
    assert.equal(params.get("still_applies"), "true");
  });

  it("serializes still_applies false", () => {
    const params = filtersToSearchParams({ still_applies: false });
    assert.equal(params.get("still_applies"), "false");
  });

  it("serializes sort", () => {
    const params = filtersToSearchParams({ sort: "date" });
    assert.equal(params.get("sort"), "date");
  });

  it("serializes all filters combined", () => {
    const params = filtersToSearchParams({
      q: "test",
      severity: ["critical"],
      source_kind: ["rules_doc"],
      tags: ["bug"],
      still_applies: true,
      sort: "date",
    });
    assert.equal(params.get("q"), "test");
    assert.deepEqual(params.getAll("severity"), ["critical"]);
    assert.deepEqual(params.getAll("source_kind"), ["rules_doc"]);
    assert.deepEqual(params.getAll("tags"), ["bug"]);
    assert.equal(params.get("still_applies"), "true");
    assert.equal(params.get("sort"), "date");
  });
});

describe("searchParamsToFilters", () => {
  it("parses empty params to empty filters", () => {
    const filters = searchParamsToFilters(new URLSearchParams());
    assert.deepEqual(filters, {});
  });

  it("round-trips empty filters", () => {
    const original: LessonFilters = {};
    const params = filtersToSearchParams(original);
    const roundTripped = searchParamsToFilters(params);
    assert.deepEqual(roundTripped, original);
  });

  it("round-trips severity filters", () => {
    const original: LessonFilters = { severity: ["high", "medium"] };
    const params = filtersToSearchParams(original);
    const roundTripped = searchParamsToFilters(params);
    assert.deepEqual(roundTripped.severity, original.severity);
  });

  it("round-trips all filters combined", () => {
    const original: LessonFilters = {
      q: "search term",
      severity: ["critical", "high"],
      source_kind: ["rules_doc", "pr_review_inline"],
      tags: ["security", "bug"],
      still_applies: true,
      sort: "date",
    };
    const params = filtersToSearchParams(original);
    const roundTripped = searchParamsToFilters(params);
    assert.equal(roundTripped.q, original.q);
    assert.deepEqual(roundTripped.severity, original.severity);
    assert.deepEqual(roundTripped.source_kind, original.source_kind);
    assert.deepEqual(roundTripped.tags, original.tags);
    assert.equal(roundTripped.still_applies, original.still_applies);
    assert.equal(roundTripped.sort, original.sort);
  });

  it("parses still_applies=false correctly", () => {
    const params = new URLSearchParams("still_applies=false");
    const filters = searchParamsToFilters(params);
    assert.equal(filters.still_applies, false);
  });

  it("ignores unknown still_applies value", () => {
    const params = new URLSearchParams("still_applies=maybe");
    const filters = searchParamsToFilters(params);
    assert.equal(filters.still_applies, undefined);
  });
});
