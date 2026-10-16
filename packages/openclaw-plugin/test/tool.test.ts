import { describe, expect, it } from "vitest";
import type { Extraction } from "@idx/core";
import { fixtureVocab } from "../../core/test/fixtures/vocab.ts";
import { createParseTool } from "../index.ts";

const handbookExtraction: Extraction = {
  text: "Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  minBeds: { value: 3, evidence: "3-bedroom" },
  types: [{ value: "condos", evidence: "condos" }],
  maxPrice: { value: 1_500_000, evidence: "under $1.5M" },
  pool: { value: true, priority: "must", evidence: "with a pool" },
};

describe("parse_property_query tool", () => {
  it("returns the resolver result in details and a JSON summary as text", async () => {
    const tool = createParseTool(fixtureVocab);
    expect(tool.name).toBe("parse_property_query");

    const result = await tool.execute("t1", handbookExtraction);

    expect(result.details.outcome).toBe("ok");
    // OpenClaw grades any non-ok `status` in details as a failed tool call.
    expect(Object.hasOwn(result.details, "status")).toBe(false);
    const text = JSON.parse(result.content[0].text);
    expect(text).toMatchObject({ outcome: "ok", summary: expect.stringContaining("Irvine"), issues: [] });
  });
});
