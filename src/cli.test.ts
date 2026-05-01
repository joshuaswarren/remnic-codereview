// CLI argument parsing tests — TDD green phase.
// Tests cover: --help, --version, unknown subcommand, invalid flag values,
// valid invocations, missing required args, and subcommand structure.

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProgram, type ParsedCommand } from "./cli.js";

/** Helper: run the CLI program with the given args and capture output/exit. */
interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
	result: ParsedCommand | undefined;
}

/** Narrow the parsed command to a specific variant by command name. */
function asCmd<T extends ParsedCommand["command"]>(
	result: ParsedCommand | undefined,
	command: T,
): Extract<ParsedCommand, { command: T }> | undefined {
	if (result && result.command === command) {
		return result as Extract<ParsedCommand, { command: T }>;
	}
	return undefined;
}

function runCli(args: string[]): CliResult {
	let stdout = "";
	let stderr = "";
	let code = 0;
	let result: ParsedCommand | undefined;

	const program = createProgram({
		getVersion: () => "0.1.0",
		execute: (cmd) => {
			result = cmd;
		},
		writeOut: (s) => {
			stdout += s;
		},
		writeErr: (s) => {
			stderr += s;
		},
		exitOverride: () => {
			throw { exitCode: 1, code: "COMMANDER_EXIT_OVERRIDE" };
		},
	});

	try {
		program.parse(["node", "cli.js", ...args]);
	} catch (e: unknown) {
		const err = e as { exitCode?: number; code?: string };
		if (err.code === "COMMANDER_EXIT_OVERRIDE") {
			code = err.exitCode ?? 1;
		} else {
			throw e;
		}
	}

	return { code, stdout, stderr, result };
}

describe("CLI --help", () => {
	it("exits 0 and prints usage text", () => {
		const { stdout } = runCli(["--help"]);
		assert.match(stdout, /Usage:/);
		assert.match(stdout, /init/);
		assert.match(stdout, /ingest/);
		assert.match(stdout, /lessons/);
		assert.match(stdout, /review/);
		assert.match(stdout, /serve/);
	});

	it("mentions --memory-dir and --quality in help output", () => {
		const { stdout } = runCli(["--help"]);
		assert.match(stdout, /--memory-dir/);
		assert.match(stdout, /--quality/);
	});

	it("-h is alias for --help", () => {
		const { stdout } = runCli(["-h"]);
		assert.match(stdout, /Usage:/);
	});
});

describe("CLI --version", () => {
	it("exits 0 and prints version from package.json", () => {
		const { stdout } = runCli(["--version"]);
		assert.match(stdout, /^0\.1\.0/);
	});

	it("-V is alias for --version", () => {
		const { stdout } = runCli(["-V"]);
		assert.match(stdout, /^0\.1\.0/);
	});
});

describe("CLI unknown subcommand", () => {
	it("exits non-zero for unknown subcommand", () => {
		const { code, stderr } = runCli(["unknown-cmd"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /unknown command/i);
	});

	it("suggests --help in the error message (VAL-M1-004)", () => {
		const { code, stderr } = runCli(["bogus-subcommand"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /--help/i);
	});
});

describe("CLI --quality validation", () => {
	it("rejects invalid --quality value with valid options listed", () => {
		const { code, stderr } = runCli(["--quality", "invalid", "ingest", "--rules", "/tmp/test"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /default.*high.*cheap|cheap.*default.*high/i);
	});

	it("accepts --quality default", () => {
		const r = asCmd(
			runCli(["--quality", "default", "ingest", "--rules", "/tmp/test"]).result,
			"ingest",
		);
		assert.equal(r?.quality, "default");
	});

	it("accepts --quality high", () => {
		const r = asCmd(
			runCli(["--quality", "high", "ingest", "--rules", "/tmp/test"]).result,
			"ingest",
		);
		assert.equal(r?.quality, "high");
	});

	it("accepts --quality cheap", () => {
		const r = asCmd(
			runCli(["--quality", "cheap", "ingest", "--rules", "/tmp/test"]).result,
			"ingest",
		);
		assert.equal(r?.quality, "cheap");
	});
});

describe("CLI init subcommand", () => {
	it("requires --owner and --repo", () => {
		const { code } = runCli(["init"]);
		assert.notEqual(code, 0);
	});

	it("parses valid init invocation", () => {
		const r = asCmd(runCli(["init", "--owner", "acme", "--repo", "widgets"]).result, "init");
		assert.equal(r?.command, "init");
		assert.equal(r?.owner, "acme");
		assert.equal(r?.repo, "widgets");
	});

	it("accepts --memory-dir", () => {
		const r = asCmd(
			runCli(["init", "--owner", "acme", "--repo", "widgets", "--memory-dir", "/tmp/test"]).result,
			"init",
		);
		assert.equal(r?.memoryDir, "/tmp/test");
	});

	it("accepts --force flag", () => {
		const r = asCmd(
			runCli(["init", "--owner", "acme", "--repo", "widgets", "--force"]).result,
			"init",
		);
		assert.equal(r?.command, "init");
		assert.equal(r?.force, true);
	});
});

describe("CLI ingest subcommand", () => {
	it("ingest --help documents flags", () => {
		const { stdout } = runCli(["ingest", "--help"]);
		assert.match(stdout, /--rules/);
		assert.match(stdout, /--pr-reviews/);
		assert.match(stdout, /--history/);
		assert.match(stdout, /--all/);
		assert.match(stdout, /--memory-dir/);
		assert.match(stdout, /--quality/);
	});

	it("parses ingest --rules <path>", () => {
		const r = asCmd(runCli(["ingest", "--rules", "/tmp/rules-repo"]).result, "ingest");
		assert.equal(r?.command, "ingest");
		assert.equal(r?.rulesPath, "/tmp/rules-repo");
	});

	it("parses ingest --pr-reviews <slug>", () => {
		const r = asCmd(runCli(["ingest", "--pr-reviews", "acme/widgets"]).result, "ingest");
		assert.equal(r?.command, "ingest");
		assert.equal(r?.prReviews, "acme/widgets");
	});

	it("parses ingest --history <slug>", () => {
		const r = asCmd(runCli(["ingest", "--history", "acme/widgets"]).result, "ingest");
		assert.equal(r?.command, "ingest");
		assert.equal(r?.history, "acme/widgets");
	});

	it("parses ingest --all <slug>", () => {
		const r = asCmd(runCli(["ingest", "--all", "acme/widgets"]).result, "ingest");
		assert.equal(r?.command, "ingest");
		assert.equal(r?.all, "acme/widgets");
	});

	it("parses ingest --rules with --dry-run", () => {
		const r = asCmd(runCli(["ingest", "--rules", "/tmp/rules-repo", "--dry-run"]).result, "ingest");
		assert.equal(r?.dryRun, true);
	});

	it("parses ingest with --memory-dir override", () => {
		const r = asCmd(
			runCli(["ingest", "--rules", "/tmp/rules-repo", "--memory-dir", "/custom/mem"]).result,
			"ingest",
		);
		assert.equal(r?.memoryDir, "/custom/mem");
	});
});

describe("CLI lessons subcommand", () => {
	it("lessons --help documents subcommands", () => {
		const { stdout } = runCli(["lessons", "--help"]);
		assert.match(stdout, /list/);
		assert.match(stdout, /show/);
	});

	it("parses lessons list", () => {
		const r = asCmd(runCli(["lessons", "list"]).result, "lessons-list");
		assert.equal(r?.command, "lessons-list");
	});

	it("parses lessons list --json", () => {
		const r = asCmd(runCli(["lessons", "list", "--json"]).result, "lessons-list");
		assert.equal(r?.command, "lessons-list");
		assert.equal(r?.json, true);
	});

	it("parses lessons list --filter severity=high", () => {
		const r = asCmd(
			runCli(["lessons", "list", "--filter", "severity=high"]).result,
			"lessons-list",
		);
		assert.equal(r?.command, "lessons-list");
		assert.deepEqual(r?.filter, { severity: "high" });
	});

	it("parses lessons list --sort original_incident_date", () => {
		const r = asCmd(
			runCli(["lessons", "list", "--sort", "original_incident_date"]).result,
			"lessons-list",
		);
		assert.equal(r?.command, "lessons-list");
		assert.equal(r?.sort, "original_incident_date");
	});

	it("parses lessons list --limit 10", () => {
		const r = asCmd(runCli(["lessons", "list", "--limit", "10"]).result, "lessons-list");
		assert.equal(r?.command, "lessons-list");
		assert.equal(r?.limit, 10);
	});

	it("parses lessons list --cursor abc123", () => {
		const r = asCmd(runCli(["lessons", "list", "--cursor", "abc123"]).result, "lessons-list");
		assert.equal(r?.command, "lessons-list");
		assert.equal(r?.cursor, "abc123");
	});

	it("parses lessons show <id>", () => {
		const r = asCmd(runCli(["lessons", "show", "les_01HXABC"]).result, "lessons-show");
		assert.equal(r?.command, "lessons-show");
		assert.equal(r?.lessonId, "les_01HXABC");
	});

	it("rejects invalid --severity value on lessons list", () => {
		const { code, stderr } = runCli(["lessons", "list", "--filter", "severity=fake"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /critical.*high.*medium.*low.*info/i);
	});

	it("rejects invalid --filter key on lessons list", () => {
		const { code, stderr } = runCli(["lessons", "list", "--filter", "nonexistent=value"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /unknown filter key/i);
	});

	it("rejects invalid --sort key on lessons list", () => {
		const { code, stderr } = runCli(["lessons", "list", "--sort", "bogus_field"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /invalid sort key/i);
	});
});

describe("CLI review subcommand", () => {
	it("review --help documents flags", () => {
		const { stdout } = runCli(["review", "--help"]);
		assert.match(stdout, /--dry-run/);
		assert.match(stdout, /--target/);
		assert.match(stdout, /--memory-dir/);
		assert.match(stdout, /--quality/);
		assert.match(stdout, /--threshold/);
	});

	it("parses review <owner/repo> <pr-number>", () => {
		const r = asCmd(runCli(["review", "acme/widgets", "42"]).result, "review");
		assert.equal(r?.command, "review");
		assert.equal(r?.slug, "acme/widgets");
		assert.equal(r?.prNumber, 42);
	});

	it("rejects non-numeric PR number", () => {
		const { code, stderr } = runCli(["review", "acme/widgets", "banana"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /invalid.*pr.number|not a number/i);
	});

	it("requires slug and pr-number", () => {
		const { code } = runCli(["review"]);
		assert.notEqual(code, 0);
	});

	it("requires pr-number after slug", () => {
		const { code } = runCli(["review", "acme/widgets"]);
		assert.notEqual(code, 0);
	});

	it("rejects invalid --quality on review", () => {
		const { code, stderr } = runCli(["--quality", "turbo", "review", "acme/widgets", "42"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /default.*high.*cheap/i);
	});
});

describe("CLI serve subcommand", () => {
	it("serve --help documents flags", () => {
		const { stdout } = runCli(["serve", "--help"]);
		assert.match(stdout, /--port/);
		assert.match(stdout, /--memory-dir/);
	});

	it("parses serve with default port", () => {
		const r = asCmd(runCli(["serve"]).result, "serve");
		assert.equal(r?.command, "serve");
		assert.equal(r?.port, 4317);
	});

	it("parses serve --port 5000", () => {
		const r = asCmd(runCli(["serve", "--port", "5000"]).result, "serve");
		assert.equal(r?.command, "serve");
		assert.equal(r?.port, 5000);
	});

	it("parses serve --memory-dir", () => {
		const r = asCmd(runCli(["serve", "--memory-dir", "/tmp/mem"]).result, "serve");
		assert.equal(r?.command, "serve");
		assert.equal(r?.memoryDir, "/tmp/mem");
	});
});

describe("CLI global flags", () => {
	it("rejects unknown global flag", () => {
		const { code, stderr } = runCli(["--bogus-flag"]);
		assert.notEqual(code, 0);
		assert.match(stderr, /unknown option/i);
	});

	it("--memory-dir expands tilde", () => {
		const r = asCmd(
			runCli(["init", "--owner", "acme", "--repo", "widgets", "--memory-dir", "~/remnic-test"])
				.result,
			"init",
		);
		assert.ok(r?.memoryDir);
		assert.ok(!r.memoryDir.startsWith("~"), "Tilde should be expanded");
		assert.ok(r.memoryDir.includes("remnic-test"), "Path should contain remnic-test");
	});
});
