import { describe, expect, it } from "vitest";

import { quoteBody } from "./quote-body.ts";
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

describe("quoteBody — attribution", () => {
  it("uses from.name when present", () => {
    const result = quoteBody(
      makeEmail({
        from: { name: "Ada", address: "ada@x" },
        date: new Date("2026-04-19T12:00:00Z"),
        text: "hi",
      }),
    );

    expect(result.text).toContain(
      "On 2026-04-19T12:00:00.000Z, Ada wrote:",
    );
  });

  it("falls back to from.address when name is missing", () => {
    const result = quoteBody(
      makeEmail({
        from: { address: "ada@x" },
        date: new Date("2026-04-19T12:00:00Z"),
        text: "hi",
      }),
    );

    expect(result.text).toContain(
      "On 2026-04-19T12:00:00.000Z, ada@x wrote:",
    );
  });

  it("drops date when only from is present", () => {
    const result = quoteBody(
      makeEmail({ from: { address: "ada@x" }, text: "hi" }),
    );

    expect(result.text).toContain("ada@x wrote:");
    expect(result.text).not.toContain("On undefined");
  });

  it("uses `someone` when only date is present", () => {
    const result = quoteBody(
      makeEmail({ date: new Date("2026-04-19T12:00:00Z"), text: "hi" }),
    );

    expect(result.text).toContain(
      "On 2026-04-19T12:00:00.000Z, someone wrote:",
    );
  });

  it("omits the attribution line entirely when both from and date are missing", () => {
    const result = quoteBody(makeEmail({ text: "hi" }));

    expect(result.text.startsWith(">")).toBe(true);
    expect(result.html.startsWith("<blockquote>")).toBe(true);
  });
});

describe("quoteBody — HTML source", () => {
  it("uses original.html when present", () => {
    const result = quoteBody(
      makeEmail({
        from: { address: "ada@x" },
        html: "<p>Hello <b>world</b></p>",
      }),
    );

    expect(result.html).toContain("<blockquote><p>Hello <b>world</b></p></blockquote>");
  });

  it("converts text to simple HTML when html is absent", () => {
    const result = quoteBody(
      makeEmail({
        from: { address: "ada@x" },
        text: "line1\nline2 <with> & \"special\" chars",
      }),
    );

    expect(result.html).toContain("line1<br>");
    expect(result.html).toContain("&lt;with&gt;");
    expect(result.html).toContain("&amp;");
    expect(result.html).toContain("&quot;special&quot;");
  });
});

describe("quoteBody — text quote", () => {
  it("prefixes every line with `> `", () => {
    const result = quoteBody(
      makeEmail({ from: { address: "ada@x" }, text: "line1\nline2\nline3" }),
    );

    expect(result.text).toContain("> line1\n> line2\n> line3");
  });

  it("handles empty text gracefully", () => {
    const result = quoteBody(
      makeEmail({ from: { address: "ada@x" }, text: "" }),
    );

    expect(result.text).toContain("ada@x wrote:");
  });
});
