// API types — mirrors the backend Lesson schema and API response shapes.

/** Valid severity levels. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Valid source kinds. */
export type SourceKind =
  | "rules_doc"
  | "pr_review_overall"
  | "pr_review_inline"
  | "pr_review_reply"
  | "pr_discussion"
  | "changelog"
  | "adr"
  | "post_mortem"
  | "closed_issue"
  | "fix_commit";

/** Lesson — the primary data shape. */
export interface Lesson {
  id: string;
  summary: string;
  severity: Severity;
  source_kind: SourceKind;
  source_url: string;
  original_incident_date: string;
  still_applies: boolean;
  tags: string[];
  files_touched_glob?: string[];
  pattern_keywords?: string[];
  what_to_check?: string;
  suggested_fix_template?: string;
  related_lessons?: string[];
  code_examples?: string[];
  source_hash?: string;
  metadata?: Record<string, unknown>;
}

/** Paginated lessons response from GET /api/lessons. */
export interface LessonsResponse {
  items: Lesson[];
  cursor?: string;
  total?: number;
}

/** API error response shape. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/** Valid sort keys for the lessons API. */
export type SortKey = "date";

/** Filter state for the lessons browser.
 *  With exactOptionalPropertyTypes, we use a helper type that allows
 *  explicitly passing undefined to clear a filter. */
export type LessonFilters = {
  q?: string | undefined;
  severity?: Severity[] | undefined;
  source_kind?: SourceKind[] | undefined;
  tags?: string[] | undefined;
  still_applies?: boolean | undefined;
  sort?: SortKey | undefined;
};

/** All severity values for the filter chips. */
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

/** All source kind values for the filter dropdown. */
export const SOURCE_KINDS: SourceKind[] = [
  "rules_doc",
  "pr_review_overall",
  "pr_review_inline",
  "pr_review_reply",
  "pr_discussion",
  "changelog",
  "adr",
  "post_mortem",
  "closed_issue",
  "fix_commit",
];

/** Severity color map. */
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "var(--color-severity-critical)",
  high: "var(--color-severity-high)",
  medium: "var(--color-severity-medium)",
  low: "var(--color-severity-low)",
  info: "var(--color-severity-info)",
};
