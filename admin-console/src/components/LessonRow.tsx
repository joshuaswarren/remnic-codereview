// Lesson row — a single row in the lessons table.

import type { Lesson } from "../lib/api-types";
import { SEVERITY_COLORS } from "../lib/api-types";
import { clsx } from "clsx";

interface LessonRowProps {
  lesson: Lesson;
  onClick: () => void;
  isFocused: boolean;
}

export function LessonRow({ lesson, onClick, isFocused }: LessonRowProps) {
  const dateStr = new Date(lesson.original_incident_date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full text-left px-4 py-3 rounded-lg border transition-colors",
        "hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]",
      )}
      style={{
        backgroundColor: isFocused ? "var(--color-surface-secondary)" : "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
      aria-label={`Lesson: ${lesson.summary}`}
    >
      <div className="flex items-start gap-3">
        {/* Severity badge */}
        <span
          className="shrink-0 mt-0.5 w-2 h-2 rounded-full"
          style={{ backgroundColor: SEVERITY_COLORS[lesson.severity] }}
          aria-label={`Severity: ${lesson.severity}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
              {lesson.summary}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-surface-secondary)",
                color: "var(--color-text-secondary)",
              }}
            >
              {lesson.source_kind.replace(/_/g, " ")}
            </span>
            {lesson.tags.slice(0, 3).map((tag) => (
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
            {lesson.tags.length > 3 && (
              <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                +{lesson.tags.length - 3}
              </span>
            )}
            <span className="text-xs ml-auto" style={{ color: "var(--color-text-secondary)" }}>
              {dateStr}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
