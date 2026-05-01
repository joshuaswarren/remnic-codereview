// Init command — creates per-repo memory dir and config snapshot.
// Refuses to overwrite existing config without --force (Remnic Rule #54 atomic write).
// Expands ~ via expandTilde() (Remnic Rule #17).

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QualityPreset } from "../cli.js";
import { expandTilde } from "../utils/expand-tilde.js";

/** Options for the init command. */
export interface InitOptions {
	owner: string;
	repo: string;
	memoryDir: string;
	force: boolean;
	quality: QualityPreset;
}

/** Quality preset model configuration. */
interface PresetConfig {
	extraction: string;
	judge: string;
	embed: string;
}

/** Quality presets mapping — same as config.ts. */
const QUALITY_PRESETS: Record<string, PresetConfig> = {
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

/** Default preset as a constant for safe access. */
const DEFAULT_PRESET: PresetConfig = QUALITY_PRESETS.default ?? {
	extraction: "gpt-5.4-mini",
	judge: "gpt-5.4-nano",
	embed: "text-embedding-3-small",
};

/**
 * Run the init command: create memory dir and write config.json.
 * Throws on error conditions (caller should catch and exit non-zero).
 */
export function runInit(opts: InitOptions): void {
	const memoryDir = expandTilde(opts.memoryDir);

	// Validate: memoryDir must not point at an existing regular file
	if (existsSync(memoryDir) && !statSync(memoryDir).isDirectory()) {
		throw new Error(`Cannot create directory: "${memoryDir}" already exists as a regular file.`);
	}

	const configPath = join(memoryDir, "config.json");

	// Check if already initialized
	if (existsSync(configPath) && !opts.force) {
		throw new Error(`Already initialized: ${configPath} exists. Use --force to overwrite.`);
	}

	// Ensure the directory exists (including parent dirs)
	mkdirSync(memoryDir, { recursive: true });

	// Build the config snapshot
	const preset = QUALITY_PRESETS[opts.quality] ?? DEFAULT_PRESET;

	// Check for env var overrides (env vars take priority over preset)
	const extraction = process.env.OPENAI_EXTRACTION_MODEL ?? preset.extraction;
	const judge = process.env.OPENAI_JUDGE_MODEL ?? preset.judge;
	const embed = process.env.OPENAI_EMBED_MODEL ?? preset.embed;

	const config = {
		owner: opts.owner,
		repo: opts.repo,
		memory_dir: memoryDir,
		model_defaults: { extraction, judge, embed },
		quality: opts.quality,
	};

	// Atomic write: write to .tmp then rename (Remnic Rule #54)
	const tmpPath = `${configPath}.tmp.${Date.now()}`;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	renameSync(tmpPath, configPath);

	// Report what was created
	console.log(`Initialized memory directory: ${memoryDir}`);
	console.log(`Created config: ${configPath}`);
	console.log(`  owner:  ${config.owner}`);
	console.log(`  repo:   ${config.repo}`);
	console.log(
		`  models: extraction=${config.model_defaults.extraction}, judge=${config.model_defaults.judge}, embed=${config.model_defaults.embed}`,
	);
}
