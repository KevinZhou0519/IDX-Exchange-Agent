import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import plugin from "../index.ts";

describe("plugin registration", () => {
  it("explains how to fix a missing vocabulary next to the bundle", () => {
    // The source folder has no data/vocab.json (only the built dist does).
    const api = { registerTool: () => {} };
    expect(() => plugin.register(api as never)).toThrow(/corepack pnpm vocab && corepack pnpm build:plugin/);
  });
});

describe("plugin manifest and skills", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("declares every tool the plugin registers", async () => {
    const { createTools } = await import("../index.ts");
    const { fakeDeps } = await import("./fake-deps.ts");
    const manifest = JSON.parse(read("../openclaw.plugin.json"));
    expect(manifest.contracts.tools).toEqual(Object.keys(createTools(fakeDeps(1), "chat")));
  });

  it("ships the market-stats skill, and the search skill points market questions to it", () => {
    const skill = read("../skills/market-stats/SKILL.md");
    expect(skill).toMatch(/^---\nname: market-stats\ndescription: .+\n---\n/);
    expect(skill).toContain("market_report");
    expect(read("../skills/property-search/SKILL.md")).toContain("market-stats");
  });
});
