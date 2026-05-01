// CLI production entry point — wires createProgram to real I/O.
// Built as dist/cli.js with a shebang for direct execution.

import { readFileSync } from "node:fs";
import { runInit } from "./cli/init.js";
import { createProgram, type ParsedCommand } from "./cli.js";

function getVersion(): string {
	try {
		const url = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(url, "utf-8")) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function executeCommand(cmd: ParsedCommand): void {
	switch (cmd.command) {
		case "init":
			try {
				runInit({
					owner: cmd.owner,
					repo: cmd.repo,
					memoryDir: cmd.memoryDir ?? `~/.remnic-codereview/${cmd.owner}__${cmd.repo}`,
					force: cmd.force,
					quality: cmd.quality,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Error: ${message}\n`);
				process.exit(1);
			}
			break;
		default:
			process.stderr.write(`Subcommand "${cmd.command}" is not yet implemented.\n`);
			process.exit(1);
	}
}

const program = createProgram({
	getVersion,
	execute: executeCommand,
});

program.parse();
