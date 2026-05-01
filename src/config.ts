// Config loader — reads defaults → config.json → env vars → CLI flags.
// Validates via Zod, coerces booleans, expands tildes.

import { readFileSync } from "node:fs";
import type { Config } from "./schemas/config.js";
import { ConfigSchema } from "./schemas/config.js";
import { coerceBool } from "./utils/coerce-bool.js";
import { expandTilde } from "./utils/expand-tilde.js";

/** CLI-level overrides passed from the commander subcommand. */
export interface CliOverrides {
	extractionModel?: string;
	judgeModel?: string;
	embedModel?: string;
	quality?: "default" | "high" | "cheap";
	dryRun?: boolean;
	memoryDir?: string;
}

/** Input to the config loader. */
export interface LoadConfigInput {
	owner?: string;
	repo?: string;
	memoryDir?: string;
	configPath?: string;
	cliOverrides?: CliOverrides;
}

/** Quality presets mapping. */
const QUALITY_PRESETS: Record<string, { extraction: string; judge: string; embed: string }> = {
	default: {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	},
	high: {
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-mini",
		embed: "text-embedding-3-large",
	},
	cheap: {
		extraction: "gpt-5.4-nano",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	},
};

/**
 * Load and validate configuration from defaults, config file, env vars, and CLI flags.
 * Priority (later wins): defaults → config.json → env vars → CLI flags.
 * Throws on invalid values — never silently defaults.
 */
export function loadConfig(input: LoadConfigInput): Config {
	// 1. Start with defaults
	const raw: Record<string, unknown> = {};

	// 2. Merge config.json if provided and exists
	if (input.configPath) {
		try {
			const contents = readFileSync(input.configPath, "utf-8");
			const parsed = JSON.parse(contents) as Record<string, unknown>;
			if (typeof parsed === "object" && parsed !== null) {
				Object.assign(raw, parsed);
			}
		} catch {
			// Config file doesn't exist or is invalid JSON — skip it
		}
	}

	// 3. Merge CLI args
	if (input.owner) raw.owner = input.owner;
	if (input.repo) raw.repo = input.repo;
	if (input.memoryDir) raw.memory_dir = expandTilde(input.memoryDir);

	// 4. Build model defaults from env vars
	const modelDefaults: Record<string, string> = {};

	// Start with existing model_defaults from config file if present
	if (typeof raw.model_defaults === "object" && raw.model_defaults !== null) {
		const existing = raw.model_defaults as Record<string, unknown>;
		if (typeof existing.extraction === "string") modelDefaults.extraction = existing.extraction;
		if (typeof existing.judge === "string") modelDefaults.judge = existing.judge;
		if (typeof existing.embed === "string") modelDefaults.embed = existing.embed;
	}

	// Env vars override config.json
	const envExtraction = process.env.OPENAI_EXTRACTION_MODEL;
	const envJudge = process.env.OPENAI_JUDGE_MODEL;
	const envEmbed = process.env.OPENAI_EMBED_MODEL;
	if (envExtraction) modelDefaults.extraction = envExtraction;
	if (envJudge) modelDefaults.judge = envJudge;
	if (envEmbed) modelDefaults.embed = envEmbed;

	// 5. CLI overrides take highest priority
	const cli = input.cliOverrides ?? {};
	if (cli.extractionModel) modelDefaults.extraction = cli.extractionModel;
	if (cli.judgeModel) modelDefaults.judge = cli.judgeModel;
	if (cli.embedModel) modelDefaults.embed = cli.embedModel;

	// 6. Handle quality preset — CLI override only
	const qualityValue = cli.quality ?? "default";
	const preset = QUALITY_PRESETS[qualityValue];
	if (!preset) {
		throw new Error(
			`Invalid quality preset: "${qualityValue}". Accepted values: default, high, cheap`,
		);
	}
	raw.quality = qualityValue;

	// Apply quality preset model defaults only for fields not set by config.json, env, or CLI
	if (!modelDefaults.extraction) modelDefaults.extraction = preset.extraction;
	if (!modelDefaults.judge) modelDefaults.judge = preset.judge;
	if (!modelDefaults.embed) modelDefaults.embed = preset.embed;

	raw.model_defaults = modelDefaults;

	// 7. Handle dry_run — coerce boolean strings from config.json
	if (typeof raw.dry_run === "string") {
		raw.dry_run = coerceBool(raw.dry_run);
	}
	if (cli.dryRun !== undefined) {
		raw.dry_run = cli.dryRun;
	}

	// 8. Validate and return
	const result = ConfigSchema.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		throw new Error(`Invalid configuration: ${issues}`);
	}
	return result.data;
}
