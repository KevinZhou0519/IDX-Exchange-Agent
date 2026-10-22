// Builds a self-contained OpenClaw install folder at packages/openclaw-plugin/dist:
// one bundled index.js (core + typebox inlined; openclaw/* left for the host to
// provide), the manifest, the skills and the dataset vocabulary. OpenClaw's
// install scan rejects workspace symlinks, so the source folder cannot be
// installed directly.
//
// Usage: corepack pnpm build:plugin, then restart the gateway to load changes.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DEFAULT_VOCAB_PATH } from "../packages/core/src/index.ts";

const pluginDir = fileURLToPath(new URL("../packages/openclaw-plugin/", import.meta.url));
const outDir = `${pluginDir}dist/`;

if (!existsSync(DEFAULT_VOCAB_PATH)) {
  console.error(`Missing ${DEFAULT_VOCAB_PATH}. Run: corepack pnpm vocab`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(`${outDir}data`, { recursive: true });

await build({
  entryPoints: [`${pluginDir}index.ts`],
  outfile: `${outDir}index.js`,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["openclaw", "openclaw/*"],
  logLevel: "warning",
});

const source = JSON.parse(readFileSync(`${pluginDir}package.json`, "utf8"));
const distPackage = {
  name: source.name,
  version: source.version,
  private: true,
  type: "module",
  description: source.description,
  peerDependencies: source.peerDependencies,
  openclaw: { ...source.openclaw, extensions: ["./index.js"] },
};
writeFileSync(`${outDir}package.json`, JSON.stringify(distPackage, null, 2) + "\n");
cpSync(`${pluginDir}openclaw.plugin.json`, `${outDir}openclaw.plugin.json`);
cpSync(`${pluginDir}skills`, `${outDir}skills`, { recursive: true });
cpSync(DEFAULT_VOCAB_PATH, `${outDir}data/vocab.json`);

console.log(`built ${outDir}`);
