import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { normalizeGeminiToolSchemas } from "openclaw/plugin-sdk/provider-tools";
import { createTools } from "../index.ts";
import { fakeDeps } from "./fake-deps.ts";

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

/** Every concrete value a schema node offers the model: its enum, or a small integer range. */
function offeredValues(node: JsonSchema): unknown[] {
  if (node.enum) return node.enum;
  if (node.type === "integer" && node.minimum !== undefined && node.maximum !== undefined) {
    return Array.from({ length: node.maximum - node.minimum + 1 }, (_, i) => node.minimum! + i);
  }
  return [];
}

/** Pairs each Gemini-facing node with the tool's original node at the same path. */
function* pairs(gemini: JsonSchema, original: JsonSchema, path: string): Generator<[string, JsonSchema, JsonSchema]> {
  yield [path, gemini, original];
  for (const [key, child] of Object.entries(gemini.properties ?? {})) {
    const originalChild = original.properties?.[key];
    if (originalChild) yield* pairs(child, originalChild, `${path}.${key}`);
  }
  if (gemini.items && original.items) yield* pairs(gemini.items, original.items, `${path}[]`);
}

describe("tool schemas as Gemini sees them", () => {
  it.each(["update_search", "show_listings", "show_sold_comps"] as const)("%s accepts every value the Gemini schema offers the model", (name) => {
    const tool = createTools(fakeDeps(1), "chat-a")[name];
    const [normalized] = normalizeGeminiToolSchemas({ tools: [tool] } as never);
    const rejected: string[] = [];
    for (const [path, geminiNode, originalNode] of pairs(normalized.parameters as JsonSchema, tool.parameters as JsonSchema, "params")) {
      for (const value of offeredValues(geminiNode)) {
        if (!Value.Check(originalNode as never, value)) rejected.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
    expect(rejected).toEqual([]);
  });
});
