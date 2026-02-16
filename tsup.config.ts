import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  external: [
    "node:os",
    "node:path",
    "node:fs",
    "node:child_process",
    "node:crypto",
  ],
  esbuildOptions(options) {
    options.platform = "node";
  },
});
