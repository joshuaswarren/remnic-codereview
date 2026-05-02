// URL query string serialization for lesson filters.
// Round-trips filters → URL params → filters.

import type { LessonFilters, Severity, SourceKind } from "./api-types";

/** Serialize filters to URLSearchParams. */
export function filtersToSearchParams(filters: LessonFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.q) {
    params.set("q", filters.q);
  }

  if (filters.severity && filters.severity.length > 0) {
    for (const sev of filters.severity) {
      params.append("severity", sev);
    }
  }

  if (filters.source_kind && filters.source_kind.length > 0) {
    for (const sk of filters.source_kind) {
      params.append("source_kind", sk);
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      params.append("tags", tag);
    }
  }

  if (filters.still_applies !== undefined) {
    params.set("still_applies", String(filters.still_applies));
  }

  if (filters.sort) {
    params.set("sort", filters.sort);
  }

  return params;
}

/** Parse URLSearchParams into filters. */
export function searchParamsToFilters(params: URLSearchParams): LessonFilters {
  const filters: LessonFilters = {};

  const q = params.get("q");
  if (q) {
    filters.q = q;
  }

  const severities = params.getAll("severity");
  if (severities.length > 0) {
    filters.severity = severities as Severity[];
  }

  const sourceKinds = params.getAll("source_kind");
  if (sourceKinds.length > 0) {
    filters.source_kind = sourceKinds as SourceKind[];
  }

  const tags = params.getAll("tags");
  if (tags.length > 0) {
    filters.tags = tags;
  }

  const stillApplies = params.get("still_applies");
  if (stillApplies === "true") {
    filters.still_applies = true;
  } else if (stillApplies === "false") {
    filters.still_applies = false;
  }

  const sort = params.get("sort");
  if (sort === "date") {
    filters.sort = sort;
  }

  return filters;
}

/** Build the API query string from filters. */
export function filtersToApiQuery(filters: LessonFilters): string {
  const params = filtersToSearchParams(filters);
  const cursor = filters as LessonFilters & { cursor?: string };
  if ("cursor" in cursor && cursor.cursor) {
    params.set("cursor", cursor.cursor);
  }
  params.set("limit", "25");
  return params.toString();
}
