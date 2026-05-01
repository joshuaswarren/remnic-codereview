// Tests for the Config Zod schema.
// TDD red — these should fail until config.ts (schema) is implemented.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Config schema", () => {
	it("parses a valid config with all fields", async () => {
		const { ConfigSchema } = await import("./config.js");
		const config = {
			owner: "acme",
			repo: "widgets",
			memory_dir: "/tmp/test-memory",
			model_defaults: {
				extraction: "gpt-5.4-mini",
				judge: "gpt-5.4-nano",
				embed: "text-embedding-3-small",
			},
		};
		const result = ConfigSchema.parse(config);
		assert.equal(result.owner, "acme");
		assert.equal(result.repo, "widgets");
		assert.equal(result.memory_dir, "/tmp/test-memory");
		assert.equal(result.model_defaults.extraction, "gpt-5.4-mini");
		assert.equal(result.model_defaults.judge, "gpt-5.4-nano");
		assert.equal(result.model_defaults.embed, "text-embedding-3-small");
	});

	it("applies defaults for model_defaults", async () => {
		const { ConfigSchema } = await import("./config.js");
		const config = {
			owner: "acme",
			repo: "widgets",
			memory_dir: "/tmp/test",
		};
		const result = ConfigSchema.parse(config);
		assert.equal(result.model_defaults.extraction, "gpt-5.4-mini");
		assert.equal(result.model_defaults.judge, "gpt-5.4-nano");
		assert.equal(result.model_defaults.embed, "text-embedding-3-small");
	});

	it("rejects missing required field 'owner'", async () => {
		const { ConfigSchema } = await import("./config.js");
		const config = {
			repo: "widgets",
			memory_dir: "/tmp/test",
		};
		assert.throws(() => ConfigSchema.parse(config));
	});

	it("rejects missing required field 'memory_dir'", async () => {
		const { ConfigSchema } = await import("./config.js");
		const config = {
			owner: "acme",
			repo: "widgets",
		};
		assert.throws(() => ConfigSchema.parse(config));
	});

	it("exports the ConfigSchema", async () => {
		const mod = await import("./config.js");
		assert.ok(mod.ConfigSchema, "ConfigSchema is exported");
	});
});
