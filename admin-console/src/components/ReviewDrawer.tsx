// Review drawer — detail panel showing each posted comment with cited lessons.
// Slides in from the right, closes on Esc/backdrop/click/close button.

import { useEffect, useRef, useCallback } from "react";
import type { PostedReview } from "../lib/api-types";

interface ReviewDrawerProps {
  review: PostedReview | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export function ReviewDrawer({ review, loading, error, onClose }: ReviewDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (review && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [review]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && review) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [review, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  if (!review && !loading && !error) return null;

  const prUrl = review
    ? `https://github.com/${review.owner}/${review.repo}/pull/${review.pr_number}`
    : "#";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Review detail"
    >
      <div className="absolute inset-0 bg-black/30" />

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
            Review Detail
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

          {review && (
            <div className="space-y-4">
              {/* PR link */}
              <div>
                <dt className="text-xs font-medium mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
                  Pull Request
                </dt>
                <dd className="text-sm">
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline break-all"
                    style={{ color: "var(--color-brand)" }}
                  >
                    {review.owner}/{review.repo}#{review.pr_number}
                  </a>
                </dd>
              </div>

              {/* Posted at */}
              <div>
                <dt className="text-xs font-medium mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
                  Posted At
                </dt>
                <dd className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                  {new Date(review.posted_at).toLocaleString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>

              {/* Dry run badge */}
              {review.dry_run && (
                <div>
                  <dt className="text-xs font-medium mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
                    Mode
                  </dt>
                  <dd>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--color-surface-secondary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Dry run
                    </span>
                  </dd>
                </div>
              )}

              {/* Comments */}
              <div>
                <dt className="text-xs font-medium mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  Comments ({review.comments.length})
                </dt>
                {review.comments.length === 0 && (
                  <dd>
                    <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                      No comments posted.
                    </p>
                  </dd>
                )}
                <dd className="space-y-3">
                  {review.comments.map((comment, i) => (
                    <CommentCard key={`comment-${String(i)}`} comment={comment} index={i} />
                  ))}
                </dd>
              </div>

              {/* ID */}
              <div>
                <dt className="text-xs font-medium mb-0.5" style={{ color: "var(--color-text-secondary)" }}>
                  ID
                </dt>
                <dd className="text-sm">
                  <code className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                    {review.id}
                  </code>
                </dd>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Single comment card showing path, line, body, and cited lesson. */
function CommentCard({
  comment,
  index,
}: {
  comment: {
    path: string;
    line: number;
    body: string;
    citation: {
      lesson_id: string;
      source_kind: string;
      source_url: string;
      original_date: string;
      confidence: number;
    };
  };
  index: number;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface-secondary)",
      }}
    >
      {/* File + line */}
      <div className="flex items-center gap-2 mb-2">
        <code className="text-xs font-mono" style={{ color: "var(--color-text-primary)" }}>
          {comment.path}
        </code>
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          line {comment.line}
        </span>
        <span
          className="text-xs ml-auto"
          style={{ color: "var(--color-text-secondary)" }}
          aria-label={`Comment ${index + 1}`}
        >
          #{index + 1}
        </span>
      </div>

      {/* Body */}
      <div
        className="text-xs whitespace-pre-wrap mb-3"
        style={{ color: "var(--color-text-primary)" }}
      >
        {comment.body}
      </div>

      {/* Cited lesson */}
      <div
        className="rounded border p-2"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <p className="text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
          Cited Lesson
        </p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Source:
            </span>
            <a
              href={comment.citation.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline break-all"
              style={{ color: "var(--color-brand)" }}
            >
              {comment.citation.source_url}
            </a>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Kind: {comment.citation.source_kind.replace(/_/g, " ")}
            </span>
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Confidence: {(comment.citation.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Date: {new Date(comment.citation.original_date).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Lesson ID:{" "}
              <code className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {comment.citation.lesson_id}
              </code>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
