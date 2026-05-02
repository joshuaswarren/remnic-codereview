// Sort menu — switch between sort modes.

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import type { LessonFilters } from "../lib/api-types";

interface SortMenuProps {
  filters: LessonFilters;
  onChange: (filters: LessonFilters) => void;
}

const SORT_OPTIONS: { value: LessonFilters["sort"]; label: string }[] = [
  { value: undefined, label: "Default" },
  { value: "date", label: "Date (newest first)" },
];

export function SortMenu({ filters, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const currentLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label ?? "Default";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Sort lessons"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={clsx(
          "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
          filters.sort
            ? "text-[var(--color-brand)] border-[var(--color-brand)]"
            : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]",
        )}
      >
        Sort: {currentLabel}
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-48 rounded-lg border shadow-lg z-20 py-1"
          style={{
            backgroundColor: "var(--color-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                onChange({ ...filters, sort: opt.value });
                setOpen(false);
              }}
              className={clsx(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)]",
                filters.sort === opt.value
                  ? "text-[var(--color-brand)] font-medium"
                  : "text-[var(--color-text-primary)]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
