// Nav header — shared layout navigation with brand and page links.

import { Link, useLocation } from "react-router-dom";
import { clsx } from "clsx";

export function NavHeader() {
  const location = useLocation();
  const isReviews = location.pathname.startsWith("/reviews");

  return (
    <header className="border-b" style={{ borderColor: "var(--color-border)" }}>
      <nav aria-label="Main navigation" className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight"
          style={{ color: "var(--color-brand)" }}
        >
          remnic-codereview
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/"
            aria-current={isReviews ? undefined : "page"}
            className={clsx(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              !isReviews
                ? "text-[var(--color-brand)] bg-[var(--color-surface-secondary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
            )}
          >
            Lessons
          </Link>
          <Link
            to="/reviews"
            aria-current={isReviews ? "page" : undefined}
            className={clsx(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              isReviews
                ? "text-[var(--color-brand)] bg-[var(--color-surface-secondary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
            )}
          >
            Reviews
          </Link>
        </div>
      </nav>
    </header>
  );
}
