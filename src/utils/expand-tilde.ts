// Utility: expand ~ to the user's home directory.
// Remnic Rule #17 — always expand tilde in user-facing paths.

import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Expand a leading `~` in a path to the user's home directory.
 * Returns the path unchanged if it does not start with `~`.
 * Handles `~/foo` and `~` (bare tilde) correctly.
 * Does NOT create the `./~` directory in CWD.
 */
export function expandTilde(inputPath: string): string {
	if (inputPath === "~") {
		return homedir();
	}
	if (inputPath === "~/") {
		return `${homedir()}/`;
	}
	if (inputPath.startsWith("~/")) {
		return resolve(homedir(), inputPath.slice(2));
	}
	return inputPath;
}
