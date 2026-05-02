// Filter bar — severity chips, source_kind dropdown, tags filter, still_applies toggle.

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import type { LessonFilters, Severity, SourceKind } from "../lib/api-types";
import { SEVERITIES, SOURCE_KINDS, SEVERITY_COLORS } from "../lib/api-types";

interface FilterBarProps {
  filters: LessonFilters;
  onChange: (filters: LessonFilters) => void;
  availableTags: string[];
}

export function FilterBar({ filters, onChange, availableTags }: FilterBarProps) {
  const [sourceKindOpen, setSourceKindOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const sourceKindRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sourceKindRef.current && !sourceKindRef.current.contains(e.target as Node)) {
        setSourceKindOpen(false);
      }
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) {
        setTagOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleSeverity(sev: Severity) {
    const current = filters.severity ?? [];
    const next = current.includes(sev)
      ? current.filter((s) => s !== sev)
      : [...current, sev];
    onChange({ ...filters, severity: next.length > 0 ? next : undefined });
  }

  function toggleSourceKind(sk: SourceKind) {
    const current = filters.source_kind ?? [];
    const next = current.includes(sk) ? current.filter((s) => s !== sk) : [...current, sk];
    onChange({ ...filters, source_kind: next.length > 0 ? next : undefined });
  }

  function toggleTag(tag: string) {
    const current = filters.tags ?? [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    onChange({ ...filters, tags: next.length > 0 ? next : undefined });
  }

  function cycleStillApplies() {
    const current = filters.still_applies;
    if (current === undefined) {
      onChange({ ...filters, still_applies: true });
    } else if (current === true) {
      onChange({ ...filters, still_applies: false });
    } else {
      onChange({ ...filters, still_applies: undefined });
    }
  }

  const stillAppliesLabel =
    filters.still_applies === undefined ? "All" : filters.still_applies ? "Active" : "Superseded";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Severity chips */}
      {SEVERITIES.map((sev) => (
        <button
          key={sev}
          type="button"
          aria-pressed={(filters.severity ?? []).includes(sev)}
          onClick={() => toggleSeverity(sev)}
          className={clsx(
            "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
            (filters.severity ?? []).includes(sev)
              ? "text-white border-transparent"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
          )}
          style={
            (filters.severity ?? []).includes(sev)
              ? { backgroundColor: SEVERITY_COLORS[sev] }
              : undefined
          }
        >
          {sev}
        </button>
      ))}

      <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--color-border)" }} />

      {/* Source kind dropdown */}
      <div className="relative" ref={sourceKindRef}>
        <button
          type="button"
          aria-label="Filter by source kind"
          aria-expanded={sourceKindOpen}
          onClick={() => setSourceKindOpen(!sourceKindOpen)}
          className={clsx(
            "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
            (filters.source_kind?.length ?? 0) > 0
              ? "text-[var(--color-brand)] border-[var(--color-brand)] bg-[var(--color-surface-secondary)]"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
          )}
        >
          Source {(filters.source_kind?.length ?? 0) > 0 ? `(${filters.source_kind?.length})` : ""}
        </button>
        {sourceKindOpen && (
          <div
            className="absolute top-full left-0 mt-1 w-56 rounded-lg border shadow-lg z-20 py-1 max-h-64 overflow-y-auto"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
            }}
          >
            {SOURCE_KINDS.map((sk) => (
              <button
                key={sk}
                type="button"
                onClick={() => toggleSourceKind(sk)}
                className={clsx(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--color-surface-hover)]",
                  (filters.source_kind ?? []).includes(sk)
                    ? "text-[var(--color-brand)]"
                    : "text-[var(--color-text-primary)]",
                )}
              >
                <span
                  className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px]"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {(filters.source_kind ?? []).includes(sk) ? "✓" : ""}
                </span>
                {sk.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tags dropdown */}
      {availableTags.length > 0 && (
        <div className="relative" ref={tagRef}>
          <button
            type="button"
            aria-label="Filter by tags"
            aria-expanded={tagOpen}
            onClick={() => setTagOpen(!tagOpen)}
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
              (filters.tags?.length ?? 0) > 0
                ? "text-[var(--color-brand)] border-[var(--color-brand)] bg-[var(--color-surface-secondary)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
            )}
          >
            Tags {(filters.tags?.length ?? 0) > 0 ? `(${filters.tags?.length})` : ""}
          </button>
          {tagOpen && (
            <div
              className="absolute top-full left-0 mt-1 w-56 rounded-lg border shadow-lg z-20 py-1 max-h-64 overflow-y-auto"
              style={{
                backgroundColor: "var(--color-surface)",
                borderColor: "var(--color-border)",
              }}
            >
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--color-surface-hover)]",
                    (filters.tags ?? []).includes(tag)
                      ? "text-[var(--color-brand)]"
                      : "text-[var(--color-text-primary)]",
                  )}
                >
                  <span
                    className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px]"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {(filters.tags ?? []).includes(tag) ? "✓" : ""}
                  </span>
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--color-border)" }} />

      {/* Still applies toggle */}
      <button
        type="button"
        onClick={cycleStillApplies}
        className={clsx(
          "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
          filters.still_applies !== undefined
            ? "text-[var(--color-brand)] border-[var(--color-brand)] bg-[var(--color-surface-secondary)]"
            : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
        )}
      >
        {stillAppliesLabel}
      </button>
    </div>
  );
}
