// Review row — a single row in the reviews table.
// Shows PR URL, posted_at date, and comment count.

import type { PostedReview } from "../lib/api-types";
import { clsx } from "clsx";

interface ReviewRowProps {
  review: PostedReview;
  onClick: () => void;
  isFocused: boolean;
}

export function ReviewRow({ review, onClick, isFocused }: ReviewRowProps) {
  const prUrl = `https://github.com/${review.owner}/${review.repo}/pull/${review.pr_number}`;
  const dateStr = new Date(review.posted_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeStr = new Date(review.posted_at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
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
      aria-label={`Review of PR #${review.pr_number} in ${review.owner}/${review.repo}`}
    >
      <div className="flex items-center gap-3">
        {/* PR URL link — clickable, opens in new tab */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium underline truncate"
              style={{ color: "var(--color-brand)" }}
            >
              {review.owner}/{review.repo}#{review.pr_number}
            </a>
            {review.dry_run && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: "var(--color-surface-secondary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                dry run
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {dateStr} {timeStr}
            </span>
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {review.comments.length} {review.comments.length === 1 ? "comment" : "comments"}
            </span>
          </div>
        </div>

        {/* Chevron indicator */}
        <svg
          className="h-4 w-4 shrink-0"
          style={{ color: "var(--color-text-secondary)" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
