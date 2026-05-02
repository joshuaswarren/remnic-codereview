// use-lessons — fetch hook for the lessons API.
// Debounces search at 250ms, handles loading/empty/error states.

import { useState, useEffect, useCallback, useRef } from "react";
import type { Lesson, LessonsResponse, LessonFilters } from "../lib/api-types";
import { filtersToApiQuery } from "../lib/query-string";

const API_BASE = "/api";

interface UseLessonsResult {
  lessons: Lesson[];
  cursor: string | undefined;
  loading: boolean;
  error: string | null;
  total: number | undefined;
}

export function useLessons(filters: LessonFilters, debounceMs = 250): UseLessonsResult {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minLoadingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLoading, setShowLoading] = useState(false);

  const fetchData = useCallback(
    (currentFilters: LessonFilters) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setShowLoading(false);

      // Show loading skeleton only after 100ms
      minLoadingRef.current = setTimeout(() => {
        setShowLoading(true);
      }, 100);

      const query = filtersToApiQuery(currentFilters);
      fetch(`${API_BASE}/lessons?${query}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
          }
          const data = (await res.json()) as LessonsResponse;
          setLessons(data.items);
          setCursor(data.cursor);
          setTotal(data.total);
          setError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Failed to fetch lessons");
          setLessons([]);
          setCursor(undefined);
        })
        .finally(() => {
          setLoading(false);
          setShowLoading(false);
          if (minLoadingRef.current) {
            clearTimeout(minLoadingRef.current);
          }
        });
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Only debounce if there's a search query; otherwise fetch immediately
    const delay = filters.q ? debounceMs : 0;
    debounceRef.current = setTimeout(() => {
      fetchData(filters);
    }, delay);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [
    filters.q,
    filters.severity,
    filters.source_kind,
    filters.tags,
    filters.still_applies,
    filters.sort,
    fetchData,
    filters,
    debounceMs,
  ]);

  return { lessons, cursor, loading: showLoading, error, total };
}

/** Fetch a single lesson by ID. */
export function useLesson(id: string | null): {
  lesson: Lesson | null;
  loading: boolean;
  error: string | null;
} {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLesson(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/lessons/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Lesson;
        setLesson(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to fetch lesson");
        setLesson(null);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [id]);

  return { lesson, loading, error };
}
