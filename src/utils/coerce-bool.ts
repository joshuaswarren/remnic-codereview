// Utility: coerce boolean-like strings to actual booleans.
// Remnic Rule #24 — coerce at config boundaries, never silently default.

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);
const VALID_BOOL_STRINGS = new Set([...TRUTHY, ...FALSY]);

/**
 * Coerce a boolean-like string to an actual boolean.
 * Accepted true values: "true", "1", "yes", "on".
 * Accepted false values: "false", "0", "no", "off".
 * All comparisons are case-insensitive.
 * Throws on any other value — callers must handle the error explicitly.
 */
export function coerceBool(value: string): boolean {
	const normalized = value.toLowerCase().trim();
	if (TRUTHY.has(normalized)) return true;
	if (FALSY.has(normalized)) return false;
	throw new Error(
		`Invalid boolean value: "${value}". Accepted values: true, false, 1, 0, yes, no, on, off`,
	);
}

/**
 * Return the set of accepted boolean string values (for error messages).
 */
export function getValidBoolStrings(): string[] {
	return [...VALID_BOOL_STRINGS];
}
