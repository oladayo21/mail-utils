import { describe, expect, it } from "vitest";

import { buildReferences } from "./references-builder.ts";
import type { ParsedEmail } from "../types.ts";

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    references: [],
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
    headers: new Map(),
    ...overrides,
  };
}

describe("buildReferences", () => {
  it("returns [] when the original has no Message-ID and no References", () => {
    expect(buildReferences(makeEmail())).toEqual([]);
  });

  it("returns just the Message-ID when References is empty", () => {
    const email = makeEmail({ messageId: "<a@x>" });

    expect(buildReferences(email)).toEqual(["<a@x>"]);
  });

  it("appends the Message-ID to the existing References", () => {
    const email = makeEmail({
      messageId: "<c@x>",
      references: ["<a@x>", "<b@x>"],
    });

    expect(buildReferences(email)).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });

  it("deduplicates while preserving first-seen order", () => {
    const email = makeEmail({
      messageId: "<b@x>",
      references: ["<a@x>", "<b@x>", "<a@x>"],
    });

    expect(buildReferences(email)).toEqual(["<a@x>", "<b@x>"]);
  });

  it("keeps the full chain when it is exactly 20 entries", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `<id${i}@x>`);
    const email = makeEmail({
      references: ids.slice(0, 19),
      messageId: ids[19],
    });

    expect(buildReferences(email)).toEqual(ids);
  });

  it("caps at 20 entries by keeping the first 3 and last 17", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `<id${i}@x>`);
    const email = makeEmail({
      references: ids.slice(0, 24),
      messageId: ids[24],
    });

    const result = buildReferences(email);

    expect(result).toHaveLength(20);
    expect(result.slice(0, 3)).toEqual([
      "<id0@x>",
      "<id1@x>",
      "<id2@x>",
    ]);
    expect(result.slice(3)).toEqual(ids.slice(25 - 17));
  });

  it("returns a fresh array — caller can mutate freely", () => {
    const email = makeEmail({
      messageId: "<a@x>",
      references: [],
    });
    const result = buildReferences(email);

    result.push("<extra@x>");

    expect(email.references).toEqual([]);
  });
});
