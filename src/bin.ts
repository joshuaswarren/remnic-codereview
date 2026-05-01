// CLI production entry point — wires createProgram to real I/O.
// Built as dist/cli.js with a shebang for direct execution.

import { readFileSync } from "node:fs";
import { createProgram } from "./cli.js";

function getVersion(): string {
	try {
		const url = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(url, "utf-8")) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const program = createProgram({
	getVersion,
	execute(_cmd) {
		// Stub: subcommand handlers will be wired in their respective features.
		process.stderr.write("Subcommand execution not yet implemented.\n");
		process.exit(1);
	},
});

program.parse();
