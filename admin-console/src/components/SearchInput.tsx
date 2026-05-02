// Search input — debounced search-as-you-type with keyboard shortcut support.

import { useRef, useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ value, onChange }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);

  // Sync external value changes (e.g., from URL)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
      onChange(e.target.value);
    },
    [onChange],
  );

  // Global keyboard shortcut: "/" focuses the search input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
        style={{ color: "var(--color-text-secondary)" }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
      <label htmlFor="lesson-search" className="sr-only">
        Search lessons
      </label>
      <input
        id="lesson-search"
        ref={inputRef}
        type="search"
        placeholder='Search lessons… (press "/" to focus)'
        value={localValue}
        onChange={handleChange}
        className={clsx(
          "w-full pl-10 pr-4 py-2 rounded-lg border text-sm",
          "focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]",
        )}
        style={{
          backgroundColor: "var(--color-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

/** Check if the target is an editable element. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
