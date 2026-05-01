// Shared error helper — never silent defaults.
// All user-facing errors go through here for consistent formatting.

/**
 * Application error with a machine-readable code and human-readable message.
 * Designed so that no error path ever silently swallows issues.
 */
export class AppError extends Error {
	readonly code: string;
	readonly exitCode: number;

	constructor(code: string, message: string, exitCode = 1) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.exitCode = exitCode;
	}
}

/**
 * Create a "not found" error for resources (lessons, reviews, files).
 */
export function notFound(resource: string, id: string): AppError {
	return new AppError("NOT_FOUND", `${resource} "${id}" not found`, 1);
}

/**
 * Create a validation error for invalid user input.
 */
export function validationError(message: string): AppError {
	return new AppError("VALIDATION_ERROR", message, 1);
}

/**
 * Create a configuration error for missing/invalid config.
 */
export function configError(message: string): AppError {
	return new AppError("CONFIG_ERROR", message, 1);
}
