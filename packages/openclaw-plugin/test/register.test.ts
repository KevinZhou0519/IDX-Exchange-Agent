import { describe, expect, it } from "vitest";
import plugin from "../index.ts";

describe("plugin registration", () => {
  it("explains how to fix a missing vocabulary next to the bundle", () => {
    // The source folder has no data/vocab.json (only the built dist does).
    const api = { registerTool: () => {} };
    expect(() => plugin.register(api as never)).toThrow(/corepack pnpm vocab && corepack pnpm build:plugin/);
  });
});
