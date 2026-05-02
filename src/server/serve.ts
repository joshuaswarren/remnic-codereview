// Serve command — wires CLI subcommand, starts Express, handles SIGINT/SIGTERM.
// Port 4317 by default. Graceful shutdown: close server, await in-flight requests.

import type { Server } from "node:http";
import { type AppOptions, createApp } from "./app.js";

export interface ServeOptions extends AppOptions {
	port: number;
}

export interface ServeResult {
	server: Server;
	shutdown: () => Promise<void>;
}

/**
 * Start the Express server on the given port.
 * Returns { server, shutdown } for programmatic control.
 */
export async function startServer(opts: ServeOptions): Promise<ServeResult> {
	const app = createApp(opts);

	const server = await new Promise<Server>((resolve, reject) => {
		const s = app.listen(opts.port, () => resolve(s));
		s.on("error", reject);
	});

	const shutdown = async (): Promise<void> => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
		await opts.adapter.shutdown();
	};

	return { server, shutdown };
}

/**
 * Run the serve command from the CLI.
 * Handles SIGINT/SIGTERM for graceful shutdown.
 */
export async function runServe(opts: ServeOptions & { memoryDir: string }): Promise<void> {
	let server: Server | undefined;
	let shutdown: (() => Promise<void>) | undefined;
	let shuttingDown = false;

	const gracefulShutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		process.stderr.write(`\nReceived ${signal}, shutting down gracefully...\n`);

		try {
			if (shutdown) {
				await shutdown();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Error during shutdown: ${message}\n`);
		}

		process.exit(0);
	};

	process.on("SIGINT", () => gracefulShutdown("SIGINT"));
	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

	try {
		const result = await startServer(opts);
		server = result.server;
		shutdown = result.shutdown;

		const addr = server.address();
		const port = addr && typeof addr === "object" ? addr.port : opts.port;
		process.stderr.write(`remnic-codereview serving on http://localhost:${port}\n`);
		process.stderr.write(`Memory dir: ${opts.memoryDir}\n`);

		// Keep the process alive
		await new Promise<void>(() => {
			// This promise never resolves — the process will be terminated by signal
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		// Check for port-in-use error
		if (message.includes("EADDRINUSE")) {
			process.stderr.write(
				`Error: Port ${opts.port} is already in use. Try a different port with --port.\n`,
			);
		} else {
			process.stderr.write(`Error: ${message}\n`);
		}
		process.exit(1);
	}
}
