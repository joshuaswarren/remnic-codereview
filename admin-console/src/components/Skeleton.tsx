// Skeleton loading component — placeholder rows while data loads.

export function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-3 py-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={`skeleton-${String(i)}`}
          className="h-14 rounded-lg animate-pulse"
          style={{ backgroundColor: "var(--color-surface-secondary)" }}
        />
      ))}
      <span className="sr-only">Loading lessons…</span>
    </div>
  );
}
