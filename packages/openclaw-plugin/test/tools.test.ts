import { describe, expect, it } from "vitest";
import { createMessageLog } from "@idx/core";
import { createTools, recordInbound } from "../index.ts";
import { fakeDeps } from "./fake-deps.ts";

const irvineMessage = { text: "homes in Irvine", attempt: 1, cities: [{ value: "Irvine", evidence: "Irvine" }] };

describe("conversational search tools", () => {
  it("names the three tools", () => {
    expect(Object.keys(createTools(fakeDeps(3), "chat-a"))).toEqual(["update_search", "show_listings", "show_sold_comps"]);
    expect(createTools(fakeDeps(3), "chat-a").update_search.name).toBe("update_search");
  });

  it("update_search returns next action and cards in details", async () => {
    const tools = createTools(fakeDeps(3), "chat-a");
    const result = await tools.update_search.execute("t1", irvineMessage);
    expect(result.details.next).toEqual({ action: "show", total: 3 });
    expect(result.details.text?.startsWith("Showing 1–3 of 3")).toBe(true);
    // OpenClaw grades any non-ok `status` in details as a failed tool call.
    expect(Object.hasOwn(result.details, "status")).toBe(false);
    const content = JSON.parse(result.content[0].text);
    expect(content).toMatchObject({ outcome: "ok", next: { action: "show" }, text: expect.stringContaining("Showing") });
  });

  it("show_listings reads the saved search for its session", async () => {
    const deps = fakeDeps(7);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const page = await createTools(deps, "chat-a").show_listings.execute("t2", { page: 2 });
    expect(page.content[0].text.startsWith("Showing 6–7 of 7")).toBe(true);
    // In Code Mode the model sees `details`, not `content`: the cards must be there.
    expect(page.details).toEqual({ total: 7, page: 2, text: page.content[0].text });
  });

  it("two sessions do not share searches", async () => {
    const deps = fakeDeps(7);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const other = await createTools(deps, "chat-b").show_listings.execute("t2", { page: 1 });
    expect(other.content[0].text).toMatch(/what you're looking for/);
  });

  it("show_sold_comps answers for the saved search", async () => {
    const deps = fakeDeps(7);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const comps = await createTools(deps, "chat-a").show_sold_comps.execute("t3", {});
    expect(comps.content[0].text).toContain("No recent sales found");
    expect(comps.details.text).toBe(comps.content[0].text);
    expect(deps.queries.at(-1)?.params).toContain("Irvine");
  });
});

describe("real inbound message", () => {
  it("update_search checks quotes against the chat's latest real message", async () => {
    const messages = createMessageLog();
    messages.record("chat-a", "homes in Irvine under $1.5M");
    const tools = createTools(fakeDeps(50), "chat-a", messages);
    const result = await tools.update_search.execute("t1", {
      text: "homes in Irvine under $2M",
      attempt: 1,
      cities: [{ value: "Irvine", evidence: "Irvine" }],
      maxPrice: { value: 2_000_000, evidence: "under $2M" },
    });
    expect(result.details.outcome).toBe("needs_retry");
  });

  it("records inbound messages from the message_received hook by session", () => {
    const messages = createMessageLog();
    recordInbound(messages, { content: "condos in Tustin", sessionKey: "chat-b" }, {});
    recordInbound(messages, { content: "ignored: no session" }, {});
    expect(messages.latest("chat-b")).toBe("condos in Tustin");
  });
});

describe("per-result instruction", () => {
  it("tells the model to ask, not to list, when the next step is ask", async () => {
    const result = await createTools(fakeDeps(723), "chat-a").update_search.execute("t1", irvineMessage);
    expect(result.details.next?.action).toBe("ask");
    expect(result.details.instruction).toMatch(/^Ask the user one question about price/);
    expect(result.details.instruction).toContain("Do not call show_listings");
  });

  it("tells the model to send the cards when the next step is show", async () => {
    const result = await createTools(fakeDeps(3), "chat-a").update_search.execute("t1", irvineMessage);
    expect(result.details.instruction).toBe("Send `text` to the user exactly as it is, then offer \"more\" or recent sales.");
  });

  it("has no instruction when the outcome needs a retry or a question about the input", async () => {
    const result = await createTools(fakeDeps(3), "chat-a").update_search.execute("t1", {
      text: "homes in Gotham",
      attempt: 1,
      cities: [{ value: "Gotham", evidence: "Gotham" }],
    });
    expect(result.details.instruction).toBeUndefined();
  });
});
