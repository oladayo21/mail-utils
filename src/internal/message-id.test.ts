import { describe, expect, it } from "vitest";

import { generateMessageId } from "./message-id.ts";

describe("generateMessageId", () => {
  it("produces ids of the documented shape", () => {
    const id = generateMessageId("example.com");

    expect(id).toMatch(/^<\d{10,}\.[0-9a-f]{16}@example\.com>$/);
  });

  it("is statistically unique over many iterations", () => {
    const ids = new Set<string>();

    for (let i = 0; i < 2000; i++) {
      ids.add(generateMessageId("example.com"));
    }

    expect(ids.size).toBe(2000);
  });

  it("embeds the current timestamp", () => {
    const before = Date.now();
    const id = generateMessageId("example.com");
    const after = Date.now();

    const match = id.match(/^<(\d+)\./);

    expect(match).not.toBeNull();
    const ts = Number(match![1]);

    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("trims whitespace around the domain", () => {
    const id = generateMessageId("  example.com  ");

    expect(id.endsWith("@example.com>")).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["only whitespace", "   "],
    ["contains space", "exam ple.com"],
    ["contains <", "exam<ple.com"],
    ["contains >", "exam>ple.com"],
    ["contains @", "exam@ple.com"],
  ])("throws on invalid domain: %s", (_label, domain) => {
    expect(() => generateMessageId(domain)).toThrow();
  });

  it("throws on non-string domain", () => {
    // @ts-expect-error — intentional runtime misuse.
    expect(() => generateMessageId(undefined)).toThrow();
    // @ts-expect-error — intentional runtime misuse.
    expect(() => generateMessageId(123)).toThrow();
  });
});
