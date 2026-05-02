// parseSinceDate — validates --since CLI flag values.
// Rejects NaN/Invalid Date values with a clear error (Remnic Rule #1).
// Used by all three --since-consuming CLI paths (--pr-reviews, --history, --all).

/**
 * Parse and validate a --since date string.
 *
 * @param value - The raw string from the CLI flag
 * @returns A valid Date object
 * @throws Error if the value cannot be parsed to a valid Date (not NaN)
 */
export function parseSinceDate(value: string): Date {
	if (!value || value.trim().length === 0) {
		throw new Error(
			`Invalid --since value: empty string. Expected a valid ISO 8601 date (e.g. 2026-01-01 or 2026-01-01T00:00:00Z).`,
		);
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw new Error(
			`Invalid --since value: "${value}" is not a valid date. Expected ISO 8601 format (e.g. 2026-01-01 or 2026-01-01T00:00:00Z).`,
		);
	}

	return date;
}
