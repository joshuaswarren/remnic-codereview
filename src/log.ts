// Structured JSON logger — writes to stderr only.
// Redacts known secret patterns from all log output.

/** Log level hierarchy */
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/** Patterns that should be redacted from any logged value. */
const SECRET_PATTERNS = [
	/sk-[a-zA-Z0-9]{20,}/g,
	/ghp_[a-zA-Z0-9]{20,}/g,
	/gho_[a-zA-Z0-9]{20,}/g,
	/ghu_[a-zA-Z0-9]{20,}/g,
	/ghs_[a-zA-Z0-9]{20,}/g,
	/ghc_[a-zA-Z0-9]{20,}/g,
	/github_pat_[a-zA-Z0-9_]{20,}/g,
];

const REDACTED = "***REDACTED***";

/**
 * Redact known secret patterns in a value.
 */
function redact(value: unknown): unknown {
	if (typeof value === "string") {
		let result = value;
		for (const pattern of SECRET_PATTERNS) {
			result = result.replaceAll(pattern, REDACTED);
		}
		return result;
	}
	if (Array.isArray(value)) {
		return value.map(redact);
	}
	if (typeof value === "object" && value !== null) {
		const redacted: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			redacted[key] = redact(val);
		}
		return redacted;
	}
	return value;
}

/**
 * Redact secrets in a fields object, returning a clean Record.
 */
function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
	const result = redact(fields);
	if (typeof result === "object" && result !== null && !Array.isArray(result)) {
		return result as Record<string, unknown>;
	}
	return fields;
}

/**
 * Write a structured JSON log entry to stderr.
 * Entries include: timestamp, level, message, and any extra fields.
 */
function writeLog(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
	const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
	if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

	const entry: Record<string, unknown> = {
		timestamp: new Date().toISOString(),
		level,
		message,
	};
	if (fields) {
		Object.assign(entry, redactFields(fields));
	}
	process.stderr.write(`${JSON.stringify(entry)}\n`);
}

/** Debug-level log (suppressed unless LOG_LEVEL=debug). */
export function debug(message: string, fields?: Record<string, unknown>): void {
	writeLog("debug", message, fields);
}

/** Info-level log. */
export function info(message: string, fields?: Record<string, unknown>): void {
	writeLog("info", message, fields);
}

/** Warning-level log. */
export function warn(message: string, fields?: Record<string, unknown>): void {
	writeLog("warn", message, fields);
}

/** Error-level log. */
export function error(message: string, fields?: Record<string, unknown>): void {
	writeLog("error", message, fields);
}
