// Error state component — shows the actual error message from the API.

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-2xl my-8 p-4 rounded-lg border"
      style={{
        borderColor: "var(--color-severity-critical)",
        backgroundColor: "color-mix(in srgb, var(--color-severity-critical) 10%, transparent)",
      }}
    >
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-severity-critical)" }}>
        Error loading lessons
      </h2>
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        {message}
      </p>
    </div>
  );
}
