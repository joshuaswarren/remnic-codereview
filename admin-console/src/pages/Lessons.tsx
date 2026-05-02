// Lessons browser page — search, filter, sort, detail drawer.
// URL state persistence via query parameters.

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useLessons } from "../hooks/use-lessons";
import { searchParamsToFilters, filtersToSearchParams } from "../lib/query-string";
import type { LessonFilters } from "../lib/api-types";
import { SearchInput } from "../components/SearchInput";
import { FilterBar } from "../components/FilterBar";
import { SortMenu } from "../components/SortMenu";
import { LessonRow } from "../components/LessonRow";
import { LessonDrawer } from "../components/LessonDrawer";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";

export function LessonsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const prevFiltersRef = useRef<string>("");

  // Initialize filters from URL
  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams]);

  // Update URL when filters change
  const updateFilters = useCallback(
    (newFilters: LessonFilters) => {
      const newParams = filtersToSearchParams(newFilters);
      const newStr = newParams.toString();
      if (newStr !== prevFiltersRef.current) {
        prevFiltersRef.current = newStr;
        setSearchParams(newParams, { replace: true });
      }
    },
    [setSearchParams],
  );

  // Track filter string for comparison
  useEffect(() => {
    prevFiltersRef.current = filtersToSearchParams(filters).toString();
  }, [filters]);

  // Fetch lessons
  const { lessons, loading, error } = useLessons(filters);

  // Extract unique tags from loaded lessons
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const lesson of lessons) {
      for (const tag of lesson.tags) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  }, [lessons]);

  // Handle search input change
  const handleSearchChange = useCallback(
    (q: string) => {
      updateFilters({ ...filters, q: q || undefined });
    },
    [filters, updateFilters],
  );

  // Handle filter changes
  const handleFilterChange = useCallback(
    (newFilters: LessonFilters) => {
      updateFilters(newFilters);
    },
    [updateFilters],
  );

  // Handle row click — open drawer
  const handleRowClick = useCallback((lessonId: string) => {
    setSelectedLessonId(lessonId);
    setFocusedRowId(lessonId);
  }, []);

  // Handle drawer close
  const handleCloseDrawer = useCallback(() => {
    setSelectedLessonId(null);
  }, []);

  // Handle Esc key when drawer is not open (should do nothing)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedLessonId) {
        handleCloseDrawer();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedLessonId, handleCloseDrawer]);

  // Determine which lesson to show in the drawer
  const selectedLesson = useMemo(
    () => lessons.find((l) => l.id === selectedLessonId) ?? null,
    [lessons, selectedLessonId],
  );

  const hasFilters =
    filters.q || (filters.severity?.length ?? 0) > 0 || (filters.source_kind?.length ?? 0) > 0;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4 sr-only">Lessons</h1>

      {/* Search + Sort bar */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <SearchInput value={filters.q ?? ""} onChange={handleSearchChange} />
        </div>
        <SortMenu filters={filters} onChange={handleFilterChange} />
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <FilterBar filters={filters} onChange={handleFilterChange} availableTags={availableTags} />
      </div>

      {/* Content */}
      <main>
        {loading && <Skeleton />}

        {error && <ErrorState message={error} />}

        {!loading && !error && lessons.length === 0 && (
          <EmptyState
            message={
              hasFilters
                ? "No lessons match the current filters."
                : "No lessons yet. Run remnic-codereview ingest --rules <path> to populate."
            }
          />
        )}

        {!loading && !error && lessons.length > 0 && (
          <div className="space-y-2">
            {lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onClick={() => handleRowClick(lesson.id)}
                isFocused={focusedRowId === lesson.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail drawer */}
      {selectedLessonId && (
        <LessonDrawer
          lesson={selectedLesson}
          loading={false}
          error={null}
          onClose={handleCloseDrawer}
        />
      )}
    </div>
  );
}
