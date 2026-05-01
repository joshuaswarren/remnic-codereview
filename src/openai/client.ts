// OpenAI client singleton — sets user-agent header per Remnic convention.
// All OpenAI calls go through this single instance.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

/** Cached package version for user-agent. */
let pkgVersion = "0.0.0";
try {
	const pkgPath = resolve(import.meta.dirname ?? ".", "../package.json");
	const raw = readFileSync(pkgPath, "utf-8");
	const parsed = JSON.parse(raw) as { version?: string };
	if (typeof parsed.version === "string") {
		pkgVersion = parsed.version;
	}
} catch {
	// Fallback — version unknown
}

/** User-agent string for all OpenAI requests. */
export const USER_AGENT = `remnic-codereview/${pkgVersion}`;

/** Lazy singleton for the OpenAI client. */
let _client: OpenAI | null = null;

/**
 * Get or create the OpenAI client singleton.
 * Reads OPENAI_API_KEY from the environment.
 * Sets user-agent header to "remnic-codereview/<version>".
 */
export function getOpenAIClient(): OpenAI {
	if (!_client) {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error("OPENAI_API_KEY is not set. Set it in your environment or secrets.env.");
		}
		_client = new OpenAI({
			apiKey,
			defaultHeaders: {
				"user-agent": USER_AGENT,
			},
		});
	}
	return _client;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetOpenAIClient(): void {
	_client = null;
}
