// Tests for the config loader (src/config.ts).
// TDD red — these should fail until config.ts is implemented.

import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("loadConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "remnic-cfg-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns defaults when config file is missing", async () => {
		const { loadConfig } = await import("./config.js");
		const cfg = loadConfig({
			owner: "acme",
			repo: "widgets",
			memoryDir: join(tempDir, "memory"),
		});
		assert.equal(cfg.owner, "acme");
		assert.equal(cfg.repo, "widgets");
		assert.equal(cfg.model_defaults.extraction, "gpt-5.4-mini");
		assert.equal(cfg.model_defaults.judge, "gpt-5.4-nano");
		assert.equal(cfg.model_defaults.embed, "text-embedding-3-small");
	});

	it("merges config.json values over defaults", async () => {
		const { loadConfig } = await import("./config.js");
		const configPath = join(tempDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				owner: "from-config",
				repo: "widgets",
				memory_dir: join(tempDir, "memory"),
				model_defaults: {
					extraction: "gpt-5.4-flash",
				},
			}),
		);
		const cfg = loadConfig({
			configPath,
		});
		assert.equal(cfg.owner, "from-config");
		assert.equal(cfg.repo, "widgets");
		assert.equal(cfg.model_defaults.extraction, "gpt-5.4-flash");
		assert.equal(cfg.model_defaults.judge, "gpt-5.4-nano");
		assert.equal(cfg.model_defaults.embed, "text-embedding-3-small");
	});

	it("CLI args override config.json values", async () => {
		const { loadConfig } = await import("./config.js");
		const configPath = join(tempDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				owner: "from-config",
				repo: "from-config-repo",
			}),
		);
		const cfg = loadConfig({
			owner: "cli-owner",
			repo: "cli-repo",
			memoryDir: join(tempDir, "memory"),
			configPath,
		});
		assert.equal(cfg.owner, "cli-owner");
		assert.equal(cfg.repo, "cli-repo");
	});

	it("throws on invalid config values in config.json", async () => {
		const { loadConfig } = await import("./config.js");
		const configPath = join(tempDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				owner: 123,
			}),
		);
		assert.throws(
			() =>
				loadConfig({
					configPath,
				}),
			{ message: /config/i },
		);
	});

	it("overrides with env vars for model defaults", async () => {
		const { loadConfig } = await import("./config.js");
		process.env.OPENAI_EXTRACTION_MODEL = "gpt-4o";
		process.env.OPENAI_JUDGE_MODEL = "gpt-4o-mini";
		process.env.OPENAI_EMBED_MODEL = "text-embedding-3-large";
		try {
			const cfg = loadConfig({
				owner: "acme",
				repo: "widgets",
				memoryDir: join(tempDir, "memory"),
			});
			assert.equal(cfg.model_defaults.extraction, "gpt-4o");
			assert.equal(cfg.model_defaults.judge, "gpt-4o-mini");
			assert.equal(cfg.model_defaults.embed, "text-embedding-3-large");
		} finally {
			delete process.env.OPENAI_EXTRACTION_MODEL;
			delete process.env.OPENAI_JUDGE_MODEL;
			delete process.env.OPENAI_EMBED_MODEL;
		}
	});

	it("CLI flags override env vars and config.json", async () => {
		const { loadConfig } = await import("./config.js");
		const configPath = join(tempDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				model_defaults: { extraction: "from-config" },
			}),
		);
		process.env.OPENAI_EXTRACTION_MODEL = "from-env";
		try {
			const cfg = loadConfig({
				owner: "acme",
				repo: "widgets",
				memoryDir: join(tempDir, "memory"),
				configPath,
				cliOverrides: { extractionModel: "from-cli" },
			});
			assert.equal(cfg.model_defaults.extraction, "from-cli");
		} finally {
			delete process.env.OPENAI_EXTRACTION_MODEL;
		}
	});

	it("expands ~ in memoryDir path", async () => {
		const { loadConfig } = await import("./config.js");
		const { homedir } = await import("node:os");
		const cfg = loadConfig({
			owner: "acme",
			repo: "widgets",
			memoryDir: "~/remnic-codereview-test",
		});
		assert.ok(
			cfg.memory_dir.startsWith(homedir()),
			`Expected memory_dir to start with homedir, got ${cfg.memory_dir}`,
		);
		assert.ok(!cfg.memory_dir.startsWith("~"), "memory_dir should not start with ~");
	});

	it("coerces boolean strings in config.json", async () => {
		const { loadConfig } = await import("./config.js");
		const configPath = join(tempDir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				dry_run: "false",
			}),
		);
		const cfg = loadConfig({
			owner: "acme",
			repo: "widgets",
			memoryDir: join(tempDir, "memory"),
			configPath,
		});
		assert.equal(cfg.dry_run, false);
	});

	it("throws on missing owner in CLI args and config.json", async () => {
		const { loadConfig } = await import("./config.js");
		assert.throws(() =>
			loadConfig({
				repo: "widgets",
				memoryDir: join(tempDir, "memory"),
			}),
		);
	});

	it("sets quality preset to default when not specified", async () => {
		const { loadConfig } = await import("./config.js");
		const cfg = loadConfig({
			owner: "acme",
			repo: "widgets",
			memoryDir: join(tempDir, "memory"),
		});
		assert.equal(cfg.quality, "default");
	});

	it("accepts valid quality preset values", async () => {
		const { loadConfig } = await import("./config.js");
		for (const quality of ["default", "high", "cheap"] as const) {
			const cfg = loadConfig({
				owner: "acme",
				repo: "widgets",
				memoryDir: join(tempDir, "memory"),
				cliOverrides: { quality },
			});
			assert.equal(cfg.quality, quality);
		}
	});

	it("throws on invalid quality value", async () => {
		const { loadConfig } = await import("./config.js");
		assert.throws(() =>
			loadConfig({
				owner: "acme",
				repo: "widgets",
				memoryDir: join(tempDir, "memory"),
				cliOverrides: { quality: "turbo" as "default" | "high" | "cheap" },
			}),
		);
	});
});
