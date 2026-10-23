import { describe, expect, it } from "vitest";
import { MESSAGE_FRESH_MS, createMessageLog } from "../src/index.ts";

describe("message log", () => {
  it("keeps the latest real message per chat", () => {
    const log = createMessageLog(() => 1_000);
    log.record("chat-a", "homes in Irvine");
    log.record("chat-a", "under $1.2M");
    log.record("chat-b", "condos in Tustin");
    expect(log.latest("chat-a")).toBe("under $1.2M");
    expect(log.latest("chat-b")).toBe("condos in Tustin");
    expect(log.latest("chat-c")).toBeUndefined();
  });

  it("forgets a message after two minutes", () => {
    let now = 1_000;
    const log = createMessageLog(() => now);
    log.record("chat-a", "homes in Irvine");
    now += MESSAGE_FRESH_MS;
    expect(log.latest("chat-a")).toBe("homes in Irvine");
    now += 1;
    expect(log.latest("chat-a")).toBeUndefined();
  });
});
