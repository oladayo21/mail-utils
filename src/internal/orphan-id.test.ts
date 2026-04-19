import { describe, expect, it } from "vitest";

import { isOrphanId, synthesizeOrphanId } from "./orphan-id.ts";
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

describe("synthesizeOrphanId", () => {
  it("produces an id of the form <orphan.{16hex}@local>", () => {
    const id = synthesizeOrphanId(
      makeEmail({
        from: { address: "ada@example.com" },
        subject: "Hello",
      }),
    );

    expect(id).toMatch(/^<orphan\.[0-9a-f]{16}@local>$/);
  });

  it("is deterministic — same input yields same id", () => {
    const email = makeEmail({
      from: { address: "ada@example.com" },
      subject: "Hello",
      date: new Date("2026-04-19T12:00:00Z"),
      text: "body text here",
    });

    expect(synthesizeOrphanId(email)).toBe(synthesizeOrphanId(email));
  });

  it("differs when the from address differs", () => {
    const a = synthesizeOrphanId(
      makeEmail({ from: { address: "a@x" }, subject: "Same" }),
    );
    const b = synthesizeOrphanId(
      makeEmail({ from: { address: "b@x" }, subject: "Same" }),
    );

    expect(a).not.toBe(b);
  });

  it("differs when the subject differs", () => {
    const a = synthesizeOrphanId(makeEmail({ subject: "Hello" }));
    const b = synthesizeOrphanId(makeEmail({ subject: "Goodbye" }));

    expect(a).not.toBe(b);
  });

  it("differs when the date differs", () => {
    const a = synthesizeOrphanId(
      makeEmail({ date: new Date("2026-04-19T00:00:00Z") }),
    );
    const b = synthesizeOrphanId(
      makeEmail({ date: new Date("2026-04-20T00:00:00Z") }),
    );

    expect(a).not.toBe(b);
  });

  it("considers the first 100 chars of body", () => {
    const base = "A".repeat(100);
    const a = synthesizeOrphanId(makeEmail({ text: base + "X" }));
    const b = synthesizeOrphanId(makeEmail({ text: base + "Y" }));

    // Both bodies share the first 100 chars, so they hash identically.
    expect(a).toBe(b);
  });

  it("handles an email with no fields populated", () => {
    const id = synthesizeOrphanId(makeEmail());

    expect(id).toMatch(/^<orphan\.[0-9a-f]{16}@local>$/);
  });
});

describe("isOrphanId", () => {
  it("recognizes synthesized ids", () => {
    const id = synthesizeOrphanId(
      makeEmail({ from: { address: "ada@x" } }),
    );

    expect(isOrphanId(id)).toBe(true);
  });

  it("rejects real Message-IDs", () => {
    expect(isOrphanId("<abc@example.com>")).toBe(false);
    expect(isOrphanId("<orphan.abc@example.com>")).toBe(false);
    expect(isOrphanId("<xyz@local>")).toBe(false);
    expect(isOrphanId("")).toBe(false);
  });
});
