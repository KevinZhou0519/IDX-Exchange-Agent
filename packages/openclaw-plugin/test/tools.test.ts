import { describe, expect, it } from "vitest";
import { createMessageLog } from "@idx/core";
import { createTools, pluginDbConfig, recordInbound, sessionScopeWarning } from "../index.ts";
import { fakeDeps } from "./fake-deps.ts";

/** Tool results can also be error shapes; tests read the success fields loosely. */
const details = (result: { details: unknown }) => result.details as Record<string, any>;

const irvineMessage = { text: "homes in Irvine", attempt: 1, cities: [{ value: "Irvine", evidence: "Irvine" }] };

describe("conversational search tools", () => {
  it("names the four tools", () => {
    expect(Object.keys(createTools(fakeDeps(3), "chat-a"))).toEqual(["update_search", "show_listings", "show_sold_comps", "market_report"]);
    expect(createTools(fakeDeps(3), "chat-a").update_search.name).toBe("update_search");
  });

  it("update_search returns next action and cards in details", async () => {
    const tools = createTools(fakeDeps(3), "chat-a");
    const result = await tools.update_search.execute("t1", irvineMessage);
    expect(details(result).next).toEqual({ action: "show", total: 3 });
    expect(details(result).text?.startsWith("Showing 1–3 of 3")).toBe(true);
    // OpenClaw grades any non-ok `status` in details as a failed tool call.
    expect(Object.hasOwn(details(result), "status")).toBe(false);
    const content = JSON.parse(result.content[0].text);
    expect(content).toMatchObject({ outcome: "ok", next: { action: "show" }, text: expect.stringContaining("Showing") });
  });

  it("show_listings reads the saved search for its session", async () => {
    const deps = fakeDeps(7);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const page = await createTools(deps, "chat-a").show_listings.execute("t2", { page: 2 });
    expect(page.content[0].text.startsWith("Showing 6–7 of 7")).toBe(true);
    // In Code Mode the model sees `details`, not `content`: the cards must be there.
    expect(details(page)).toMatchObject({ total: 7, page: 2, text: page.content[0].text });
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
    expect(details(comps).text).toBe(comps.content[0].text);
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
    expect(details(result).outcome).toBe("needs_retry");
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
    expect(details(result).next?.action).toBe("ask");
    expect(details(result).instruction).toMatch(/^Ask the user one question about price/);
    expect(details(result).instruction).toContain("Do not call show_listings");
  });

  it("tells the model to send the cards when the next step is show", async () => {
    const result = await createTools(fakeDeps(3), "chat-a").update_search.execute("t1", irvineMessage);
    expect(details(result).instruction).toBe("Send `text` to the user exactly as it is, then offer \"more\" or recent sales.");
  });

  it("has no instruction when the outcome needs a retry or a question about the input", async () => {
    const result = await createTools(fakeDeps(3), "chat-a").update_search.execute("t1", {
      text: "homes in Gotham",
      attempt: 1,
      cities: [{ value: "Gotham", evidence: "Gotham" }],
    });
    expect(details(result).instruction).toBeUndefined();
  });
});

describe("paging instructions", () => {
  it("says when the last page has been shown", async () => {
    const deps = fakeDeps(7);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const last = await createTools(deps, "chat-a").show_listings.execute("t2", { page: 2 });
    expect(details(last).instruction).toMatch(/All 7 results have now been shown/);
    const middle = await createTools(fakeDeps(12), "chat-b").show_listings.execute("t3", { page: 1 });
    expect(details(middle).instruction).toBeUndefined();
  });
});

describe("robustness", () => {
  it("refuses to share one search when a call has no session", async () => {
    const deps = fakeDeps(3);
    const tools = createTools(deps, undefined);
    const result = await tools.update_search.execute("t1", irvineMessage);
    expect(details(result)).toMatchObject({ error: "no_session" });
    expect(details(result).instruction).toMatch(/can't keep a search/);
    expect(deps.store.get("default")).toBeUndefined();
    expect(details(await tools.show_listings.execute("t2", { page: 1 }))).toMatchObject({ error: "no_session" });
  });

  it("reports a database failure as temporarily unavailable", async () => {
    const deps = fakeDeps(3);
    deps.db.query = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3306");
    };
    deps.counter.count = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3306");
    };
    const tools = createTools(deps, "chat-a");
    const update = await tools.update_search.execute("t1", irvineMessage);
    expect(details(update)).toMatchObject({ error: "search_unavailable" });
    expect(details(update).instruction).toMatch(/temporarily unavailable/);
    expect(JSON.stringify(update)).not.toContain("ECONNREFUSED");
    const page = await tools.show_listings.execute("t2", { page: 1 });
    expect(details(page)).toMatchObject({ error: "search_unavailable" });
    const market = await tools.market_report.execute("t3", { cities: ["Irvine"] });
    expect(details(market)).toMatchObject({ error: "search_unavailable" });
    expect(JSON.stringify(market)).not.toContain("ECONNREFUSED");
  });
});

describe("market_report tool", () => {
  it("returns reports, issues, outcome and instruction in details and content", async () => {
    const result = await createTools(fakeDeps(3), "chat-a").market_report.execute("t1", { cities: ["Irvine"] });
    expect(Object.keys(details(result)).sort()).toEqual(["instruction", "issues", "outcome", "reports"]);
    expect(details(result).outcome).toBe("ok");
    expect(details(result).reports[0]).toMatchObject({ city: "Irvine", overall: { sales: 40 } });
    expect(JSON.parse(result.content[0].text)).toEqual(details(result));
    expect(Object.hasOwn(details(result), "status")).toBe(false);
  });

  it("uses the city of this chat's saved search", async () => {
    const deps = fakeDeps(3);
    await createTools(deps, "chat-a").update_search.execute("t1", irvineMessage);
    const mine = await createTools(deps, "chat-a").market_report.execute("t2", {});
    expect(details(mine).reports.map((r: { city: string }) => r.city)).toEqual(["Irvine"]);
    const other = await createTools(deps, "chat-b").market_report.execute("t3", {});
    expect(details(other).outcome).toBe("needs_city");
  });

  it("needs a session like the other tools", async () => {
    const result = await createTools(fakeDeps(3), undefined).market_report.execute("t1", { cities: ["Irvine"] });
    expect(details(result)).toMatchObject({ error: "no_session" });
  });

  it("never sends listing addresses or agent names", async () => {
    const deps = fakeDeps(3);
    const result = await createTools(deps, "chat-a").market_report.execute("t1", { cities: ["Irvine", "Tustin"] });
    expect(JSON.stringify(result)).not.toMatch(/Main St|Agent|Office|UnparsedAddress/);
  });

  it("limits cities to 3 in the schema", () => {
    const schema = createTools(fakeDeps(3), "chat-a").market_report.parameters as unknown as { properties: { cities: { maxItems: number } } };
    expect(schema.properties.cities.maxItems).toBe(3);
  });
});

describe("plugin configuration", () => {
  it("always connects as the read-only user", () => {
    process.env.MYSQL_USER = "root";
    try {
      expect(pluginDbConfig().user).toBe("idx_user");
    } finally {
      delete process.env.MYSQL_USER;
    }
  });

  it("warns when direct messages share one session", () => {
    expect(sessionScopeWarning({})).toMatch(/per-channel-peer/);
    expect(sessionScopeWarning({ session: { dmScope: "main" } })).toMatch(/per-channel-peer/);
    expect(sessionScopeWarning({ session: { dmScope: "per-channel-peer" } })).toBeUndefined();
  });
});
