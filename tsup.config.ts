import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI entry point: src/bin.ts → dist/cli.js (with shebang)
    entry: { cli: "src/bin.ts" },
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node\n" },
  },
  {
    // Library modules: everything else
    entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/bin.ts"],
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    outDir: "dist",
  },
]);
