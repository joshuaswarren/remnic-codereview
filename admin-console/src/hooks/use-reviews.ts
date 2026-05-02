// use-reviews — fetch hook for the reviews API.
// Handles loading/empty/error states with skeleton threshold.

import { useState, useEffect, useRef, useCallback } from "react";
import type { PostedReview, ReviewsResponse } from "../lib/api-types";

const API_BASE = "/api";

interface UseReviewsResult {
  reviews: PostedReview[];
  loading: boolean;
  error: string | null;
}

export function useReviews(): UseReviewsResult {
  const [reviews, setReviews] = useState<PostedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const minLoadingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setShowLoading(false);

    minLoadingRef.current = setTimeout(() => {
      setShowLoading(true);
    }, 100);

    fetch(`${API_BASE}/reviews`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ReviewsResponse;
        setReviews(data.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to fetch reviews");
        setReviews([]);
      })
      .finally(() => {
        setLoading(false);
        setShowLoading(false);
        if (minLoadingRef.current) {
          clearTimeout(minLoadingRef.current);
        }
      });
  }, []);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchData]);

  return { reviews, loading: showLoading, error };
}

/** Fetch a single review by ID. */
export function useReview(id: string | null): {
  review: PostedReview | null;
  loading: boolean;
  error: string | null;
} {
  const [review, setReview] = useState<PostedReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setReview(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/reviews/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as PostedReview;
        setReview(data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to fetch review");
        setReview(null);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [id]);

  return { review, loading, error };
}
