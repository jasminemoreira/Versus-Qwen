#!/usr/bin/env node

// Bundles the 4 entry points into standalone files (no external dependencies)
// Output: out/bundle/ with 4 self-contained files

import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "out", "bundle");

// Clean and recreate
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entryPoints = [
  { in: resolve(root, "src", "hooks", "inject-context.ts"), out: "inject-context" },
  { in: resolve(root, "src", "hooks", "phase-gate.ts"), out: "phase-gate" },
  { in: resolve(root, "src", "hooks", "loop-detector.ts"), out: "loop-detector" },
  { in: resolve(root, "src", "hooks", "stop-verify.ts"), out: "stop-verify" },
  { in: resolve(root, "src", "hooks", "truncation-check.ts"), out: "truncation-check" },
  { in: resolve(root, "src", "hooks", "block-destructive.ts"), out: "block-destructive" },
  { in: resolve(root, "src", "mcp", "server.ts"), out: "server" },
];

try {
  await build({
    entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outdir: outDir,
    minify: false,        // readable for debug
    sourcemap: false,
    external: [],          // all inline, no external dependencies
  });

  console.log("Bundle completed in out/bundle/:");
  for (const e of entryPoints) {
    console.log(`  ${e.out}.js`);
  }
} catch (err) {
  console.error("Bundle error:", err);
  process.exit(1);
}
