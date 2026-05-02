// Lesson drawer — detail panel showing the full lesson schema with citation link.

import { useEffect, useRef, useCallback } from "react";
import type { Lesson } from "../lib/api-types";
import { SEVERITY_COLORS } from "../lib/api-types";

interface LessonDrawerProps {
  lesson: Lesson | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export function LessonDrawer({ lesson, loading, error, onClose }: LessonDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the close button when drawer opens
  useEffect(() => {
    if (lesson && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [lesson]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && lesson) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lesson, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  if (!lesson && !loading && !error) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Lesson detail"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-lg h-full overflow-y-auto shadow-xl border-l"
        style={{
          backgroundColor: "var(--color-surface)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-4 py-3 border-b z-10"
          style={{
            backgroundColor: "var(--color-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Lesson Detail
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-4">
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`drawer-skeleton-${String(i)}`}
                  className="h-6 rounded animate-pulse"
                  style={{ backgroundColor: "var(--color-surface-secondary)" }}
                />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: "var(--color-severity-critical)" }}>
              {error}
            </p>
          )}

          {lesson && (
            <div className="space-y-4">
              {/* Summary */}
              <div>
                <h3 className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {lesson.summary}
                </h3>
              </div>

              {/* Severity */}
              <FieldRow label="Severity">
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: SEVERITY_COLORS[lesson.severity] }}
                  />
                  <span className="capitalize">{lesson.severity}</span>
                </span>
              </FieldRow>

              {/* Source Kind */}
              <FieldRow label="Source Kind">
                <span>{lesson.source_kind.replace(/_/g, " ")}</span>
              </FieldRow>

              {/* Source URL */}
              <FieldRow label="Citation">
                {lesson.metadata?.html_url ? (
                  <a
                    href={String(lesson.metadata.html_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline break-all"
                    style={{ color: "var(--color-brand)" }}
                  >
                    View on GitHub
                  </a>
                ) : (
                  <a
                    href={lesson.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline break-all"
                    style={{ color: "var(--color-brand)" }}
                  >
                    {lesson.source_url}
                  </a>
                )}
              </FieldRow>

              {/* Date */}
              <FieldRow label="Incident Date">
                <span>
                  {new Date(lesson.original_incident_date).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </FieldRow>

              {/* Still Applies */}
              <FieldRow label="Still Applies">
                <span
                  className={
                    lesson.still_applies
                      ? "text-[var(--color-severity-low)]"
                      : "text-[var(--color-text-secondary)]"
                  }
                >
                  {lesson.still_applies ? "Yes" : "No"}
                </span>
              </FieldRow>

              {/* Tags */}
              {lesson.tags.length > 0 && (
                <FieldRow label="Tags">
                  <div className="flex flex-wrap gap-1">
                    {lesson.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: "var(--color-surface-secondary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </FieldRow>
              )}

              {/* Pattern Keywords */}
              {lesson.pattern_keywords && lesson.pattern_keywords.length > 0 && (
                <FieldRow label="Pattern Keywords">
                  <span>{lesson.pattern_keywords.join(", ")}</span>
                </FieldRow>
              )}

              {/* What to Check */}
              {lesson.what_to_check && <FieldRow label="What to Check">{lesson.what_to_check}</FieldRow>}

              {/* Suggested Fix */}
              {lesson.suggested_fix_template && (
                <FieldRow label="Suggested Fix">
                  <pre
                    className="text-xs whitespace-pre-wrap p-2 rounded border overflow-x-auto"
                    style={{
                      backgroundColor: "var(--color-surface-secondary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    {lesson.suggested_fix_template}
                  </pre>
                </FieldRow>
              )}

              {/* Files Touched */}
              {lesson.files_touched_glob && lesson.files_touched_glob.length > 0 && (
                <FieldRow label="Files Touched">
                  <code className="text-xs">{lesson.files_touched_glob.join(", ")}</code>
                </FieldRow>
              )}

              {/* Related Lessons */}
              {lesson.related_lessons && lesson.related_lessons.length > 0 && (
                <FieldRow label="Related Lessons">
                  <span>{lesson.related_lessons.join(", ")}</span>
                </FieldRow>
              )}

              {/* Code Examples */}
              {lesson.code_examples && lesson.code_examples.length > 0 && (
                <FieldRow label="Code Examples">
                  <div className="space-y-2">
                    {lesson.code_examples.map((ex, i) => (
                      <pre
                        key={`example-${String(i)}`}
                        className="text-xs whitespace-pre-wrap p-2 rounded border overflow-x-auto"
                        style={{
                          backgroundColor: "var(--color-surface-secondary)",
                          borderColor: "var(--color-border)",
                        }}
                      >
                        {ex}
                      </pre>
                    ))}
                  </div>
                </FieldRow>
              )}

              {/* ID */}
              <FieldRow label="ID">
                <code className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  {lesson.id}
                </code>
              </FieldRow>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </dt>
      <dd className="text-sm" style={{ color: "var(--color-text-primary)" }}>
        {children}
      </dd>
    </div>
  );
}
