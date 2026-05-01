// Init command tests — TDD red phase.
// Tests: init creates memory dir + config.json; init on existing dir without --force exits
// non-zero with 'already initialized'; init --force overwrites; config snapshot includes
// owner, repo, model defaults; tilde expansion; rejects file as memory-dir.

import * as assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { type InitOptions, runInit } from "./init.js";

/** Create a temp directory for a test and return its path. */
function tmpDir(prefix = "remnic-init-test-"): string {
	return mkdtempSync(join(os.tmpdir(), prefix));
}

/** Build default InitOptions for testing. */
function defaultOpts(overrides: Partial<InitOptions> = {}): InitOptions {
	const dir = tmpDir();
	return {
		owner: "acme",
		repo: "widgets",
		memoryDir: join(dir, "mem"),
		force: false,
		quality: "default",
		...overrides,
	};
}

// Track temp dirs to clean up
const tempDirs: string[] = [];

afterEach(() => {
	for (const d of tempDirs) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
	tempDirs.length = 0;
});

describe("init command", () => {
	it("creates memory dir and config.json on empty dir", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);
		// mem does NOT exist yet
		assert.equal(existsSync(mem), false);

		const opts = defaultOpts({ memoryDir: mem });
		runInit(opts);

		// Directory should now exist
		assert.equal(existsSync(mem), true, "memory dir should be created");
		assert.ok(statSync(mem).isDirectory(), "memory dir should be a directory");

		// config.json should exist
		const configPath = join(mem, "config.json");
		assert.equal(existsSync(configPath), true, "config.json should exist");

		// config.json should be valid JSON with required keys
		const raw = readFileSync(configPath, "utf-8");
		const config = JSON.parse(raw) as Record<string, unknown>;
		assert.equal(config.owner, "acme");
		assert.equal(config.repo, "widgets");
		assert.equal(config.memory_dir, mem);
		assert.ok(typeof config.model_defaults === "object" && config.model_defaults !== null);
		const md = config.model_defaults as Record<string, string>;
		assert.ok(typeof md.extraction === "string" && md.extraction.length > 0);
		assert.ok(typeof md.judge === "string" && md.judge.length > 0);
		assert.ok(typeof md.embed === "string" && md.embed.length > 0);
	});

	it("exits non-zero with 'already initialized' when config exists and --force is false", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		// First init should succeed
		const opts = defaultOpts({ memoryDir: mem });
		runInit(opts);

		// Read the config.json content to verify it stays unchanged
		const configPath = join(mem, "config.json");
		const before = readFileSync(configPath, "utf-8");

		// Second init without --force should throw
		assert.throws(
			() => {
				runInit(defaultOpts({ memoryDir: mem, force: false }));
			},
			(err: unknown) => {
				assert.ok(err instanceof Error);
				assert.match(err.message, /already initialized|exists/i);
				assert.match(err.message, /--force/i);
				return true;
			},
		);

		// config.json should be unchanged
		const after = readFileSync(configPath, "utf-8");
		assert.equal(before, after, "config.json should be unchanged");
	});

	it("overwrites existing config with --force", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		// First init
		runInit(defaultOpts({ memoryDir: mem, owner: "acme", repo: "widgets" }));

		// Verify first config
		const configPath = join(mem, "config.json");
		const first = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		assert.equal(first.owner, "acme");
		assert.equal(first.repo, "widgets");

		// Second init with --force and different owner/repo
		runInit(defaultOpts({ memoryDir: mem, owner: "newcorp", repo: "newrepo", force: true }));

		// Config should be overwritten
		const second = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		assert.equal(second.owner, "newcorp");
		assert.equal(second.repo, "newrepo");
		assert.equal(second.memory_dir, mem);
	});

	it("overwrites without leaving .tmp or .bak files", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		// First init
		runInit(defaultOpts({ memoryDir: mem }));

		// Force overwrite
		runInit(defaultOpts({ memoryDir: mem, force: true }));

		// Check no .tmp or .bak files
		const files = readdirSync(mem);
		const junk = files.filter((f) => f.endsWith(".tmp") || f.endsWith(".bak"));
		assert.equal(junk.length, 0, "No .tmp or .bak files should remain");
	});

	it("config snapshot includes model_defaults with extraction, judge, embed", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		runInit(defaultOpts({ memoryDir: mem }));

		const configPath = join(mem, "config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		const md = config.model_defaults as Record<string, string>;

		assert.equal(md.extraction, "gpt-5.4-mini");
		assert.equal(md.judge, "gpt-5.4-nano");
		assert.equal(md.embed, "text-embedding-3-small");
	});

	it("applies quality preset to model defaults", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		runInit(defaultOpts({ memoryDir: mem, quality: "high" }));

		const configPath = join(mem, "config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		const md = config.model_defaults as Record<string, string>;

		assert.equal(md.extraction, "gpt-5.4-mini");
		assert.equal(md.judge, "gpt-5.4-mini"); // high preset upgrades judge
		assert.equal(md.embed, "text-embedding-3-large"); // high preset upgrades embed
	});

	it("applies cheap quality preset to model defaults", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		runInit(defaultOpts({ memoryDir: mem, quality: "cheap" }));

		const configPath = join(mem, "config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		const md = config.model_defaults as Record<string, string>;

		assert.equal(md.extraction, "gpt-5.4-nano");
		assert.equal(md.judge, "gpt-5.4-nano");
		assert.equal(md.embed, "text-embedding-3-small");
	});

	it("expands ~ in memoryDir path", () => {
		const subdir = `remnic-init-tilde-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const expandedPath = join(os.homedir(), subdir);
		tempDirs.push(expandedPath);

		runInit(defaultOpts({ memoryDir: `~/${subdir}` }));

		assert.equal(existsSync(expandedPath), true, "Dir should be created at expanded path");
		assert.equal(existsSync(join(expandedPath, "config.json")), true);

		// Verify ./~ was NOT created in CWD
		assert.equal(existsSync("./~"), false, "Literal ./~ should not exist in CWD");
	});

	it("rejects a memoryDir that points at an existing regular file", () => {
		const tmpBase = tmpDir();
		tempDirs.push(tmpBase);
		const filePath = join(tmpBase, "not-a-dir");
		writeFileSync(filePath, "hello");

		assert.throws(
			() => {
				runInit(defaultOpts({ memoryDir: filePath }));
			},
			(err: unknown) => {
				assert.ok(err instanceof Error);
				assert.match(err.message, /not a directory|exists.*file/i);
				return true;
			},
		);

		// Original file should be unchanged
		assert.equal(readFileSync(filePath, "utf-8"), "hello");
	});

	it("reports what was created on stdout", () => {
		const mem = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(mem);

		const output = captureStdout(() => {
			runInit(defaultOpts({ memoryDir: mem }));
		});

		assert.match(output, /created|initialized/i);
		assert.match(output, /config\.json/);
	});

	it("creates parent directories if they do not exist", () => {
		const base = join(
			os.tmpdir(),
			`remnic-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		tempDirs.push(base);
		const mem = join(base, "deep", "nested", "mem");

		runInit(defaultOpts({ memoryDir: mem }));

		assert.equal(existsSync(mem), true);
		assert.equal(existsSync(join(mem, "config.json")), true);
	});
});

/** Capture stdout during a synchronous callback. */
function captureStdout(fn: () => void): string {
	const chunks: string[] = [];
	const origWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (chunk: unknown) => {
		if (typeof chunk === "string") chunks.push(chunk);
		return true;
	};
	try {
		fn();
	} finally {
		process.stdout.write = origWrite;
	}
	return chunks.join("");
}
