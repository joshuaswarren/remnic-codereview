// Reviews log page — list of past PostedReview records with detail view.
// Shows PR URL, posted_at date, comment count per row.
// Row click opens detail with each PostedComment + cited lessons.

import { useState, useCallback, useEffect, useMemo } from "react";
import { useReviews, useReview } from "../hooks/use-reviews";
import { ReviewRow } from "../components/ReviewRow";
import { ReviewDrawer } from "../components/ReviewDrawer";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";

export function ReviewsPage() {
  const { reviews, loading, error } = useReviews();
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  // Fetch the full review detail when a row is selected
  const { review: selectedReview, loading: detailLoading, error: detailError } = useReview(selectedReviewId);

  // Also find the review in the list for instant display
  const listReview = useMemo(
    () => reviews.find((r) => r.id === selectedReviewId) ?? null,
    [reviews, selectedReviewId],
  );

  // Use the detail fetch if available, otherwise fall back to the list version
  const displayReview = selectedReview ?? listReview;

  const handleRowClick = useCallback((reviewId: string) => {
    setSelectedReviewId(reviewId);
    setFocusedRowId(reviewId);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedReviewId(null);
  }, []);

  // Esc key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedReviewId) {
        handleCloseDrawer();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedReviewId, handleCloseDrawer]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Reviews</h1>

      <main>
        {loading && <Skeleton />}

        {error && <ErrorState message={error} />}

        {!loading && !error && reviews.length === 0 && (
          <EmptyState message="No reviews yet. Reviews will appear here after running the review pipeline." />
        )}

        {!loading && !error && reviews.length > 0 && (
          <div className="space-y-2">
            {reviews.map((review) => (
              <ReviewRow
                key={review.id}
                review={review}
                onClick={() => handleRowClick(review.id)}
                isFocused={focusedRowId === review.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail drawer */}
      {selectedReviewId && (
        <ReviewDrawer
          review={displayReview}
          loading={selectedReviewId !== null && !displayReview && detailLoading}
          error={detailError}
          onClose={handleCloseDrawer}
        />
      )}
    </div>
  );
}
