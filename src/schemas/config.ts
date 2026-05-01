// Config schema — top-level configuration validated at startup.
// The actual loader is in src/config.ts.

import { z } from "zod";

/** Quality presets that control model selection. */
export const QualityPreset = z.enum(["default", "high", "cheap"]);

/** Model default overrides. */
export const ModelDefaultsSchema = z.object({
	extraction: z.string().default("gpt-5.4-mini"),
	judge: z.string().default("gpt-5.4-nano"),
	embed: z.string().default("text-embedding-3-small"),
});

/** Top-level configuration. */
export const ConfigSchema = z.object({
	/** Repository owner. */
	owner: z.string().min(1),
	/** Repository name. */
	repo: z.string().min(1),
	/** Path to the per-repo memory directory. */
	memory_dir: z.string().min(1),
	/** Model defaults for extraction, judge, and embedding. */
	model_defaults: ModelDefaultsSchema.default({
		extraction: "gpt-5.4-mini",
		judge: "gpt-5.4-nano",
		embed: "text-embedding-3-small",
	}),
	/** Whether this is a dry run (no side effects). */
	dry_run: z.boolean().default(false),
	/** Quality preset. */
	quality: QualityPreset.default("default"),
});

/** Inferred TypeScript type for Config. */
export type Config = z.infer<typeof ConfigSchema>;
