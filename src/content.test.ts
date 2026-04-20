import { describe, expect, it } from "vitest";

import {
  extractBody,
  findOrphanedCidRefs,
  isInlineAttachment,
  listAttachments,
} from "./content.ts";
import type { Attachment, ParsedEmail } from "./types.ts";

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

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    mimeType: "application/octet-stream",
    disposition: "attachment",
    size: 0,
    ...overrides,
  };
}

describe("extractBody", () => {
  it("returns html when only html is present", () => {
    const body = extractBody(makeEmail({ html: "<p>hi</p>" }));

    expect(body).toEqual({ html: "<p>hi</p>" });
  });

  it("returns text when only text is present", () => {
    const body = extractBody(makeEmail({ text: "hello" }));

    expect(body).toEqual({ text: "hello" });
  });

  it("returns both when both are present", () => {
    const body = extractBody(
      makeEmail({ html: "<p>hi</p>", text: "hello" }),
    );

    expect(body).toEqual({ html: "<p>hi</p>", text: "hello" });
  });

  it("returns an empty object when neither is present", () => {
    expect(extractBody(makeEmail())).toEqual({});
  });

  it("does not sanitize HTML", () => {
    // Contract: content module never sanitizes. Caller is responsible.
    const body = extractBody(
      makeEmail({ html: '<img src=x onerror="alert(1)">' }),
    );

    expect(body.html).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("isInlineAttachment", () => {
  it("returns true for inline parts with a contentId", () => {
    expect(
      isInlineAttachment(
        makeAttachment({
          disposition: "inline",
          contentId: "<logo@example>",
        }),
      ),
    ).toBe(true);
  });

  it("returns false for inline parts missing a contentId", () => {
    expect(
      isInlineAttachment(makeAttachment({ disposition: "inline" })),
    ).toBe(false);
  });

  it("returns false for inline parts with an empty contentId", () => {
    expect(
      isInlineAttachment(
        makeAttachment({ disposition: "inline", contentId: "" }),
      ),
    ).toBe(false);
  });

  it("returns false for attachments even when a contentId is set", () => {
    expect(
      isInlineAttachment(
        makeAttachment({
          disposition: "attachment",
          contentId: "<logo@example>",
        }),
      ),
    ).toBe(false);
  });

  it("returns false for regular attachments", () => {
    expect(isInlineAttachment(makeAttachment())).toBe(false);
  });
});

describe("listAttachments", () => {
  it("filters out inline parts with a contentId", () => {
    const inline = makeAttachment({
      disposition: "inline",
      contentId: "<logo@example>",
      filename: "logo.png",
    });
    const attached = makeAttachment({
      filename: "report.pdf",
      mimeType: "application/pdf",
    });

    const result = listAttachments(
      makeEmail({ attachments: [inline, attached] }),
    );

    expect(result).toEqual([attached]);
  });

  it("keeps inline parts that lack a contentId (treated as user-facing)", () => {
    const orphanInline = makeAttachment({
      disposition: "inline",
      filename: "oops.png",
    });

    const result = listAttachments(
      makeEmail({ attachments: [orphanInline] }),
    );

    expect(result).toEqual([orphanInline]);
  });

  it("preserves original order", () => {
    const a = makeAttachment({ filename: "a.txt" });
    const cid = makeAttachment({
      disposition: "inline",
      contentId: "<cid@x>",
    });
    const b = makeAttachment({ filename: "b.txt" });

    const result = listAttachments(
      makeEmail({ attachments: [a, cid, b] }),
    );

    expect(result).toEqual([a, b]);
  });

  it("returns [] when there are no attachments", () => {
    expect(listAttachments(makeEmail())).toEqual([]);
  });

  it("returns [] when every attachment is inline with a contentId", () => {
    const attachments: Attachment[] = [
      makeAttachment({ disposition: "inline", contentId: "<1@x>" }),
      makeAttachment({ disposition: "inline", contentId: "<2@x>" }),
    ];

    expect(listAttachments(makeEmail({ attachments }))).toEqual([]);
  });
});

describe("findOrphanedCidRefs", () => {
  it("returns [] when the email has no html body", () => {
    expect(findOrphanedCidRefs(makeEmail({ text: "plain" }))).toEqual([]);
  });

  it("returns [] when every cid reference is backed by an inline attachment", () => {
    const html = `<p>top</p><img src="cid:logo@x"><img src="cid:sig@x">`;
    const attachments: Attachment[] = [
      makeAttachment({ disposition: "inline", contentId: "<logo@x>" }),
      makeAttachment({ disposition: "inline", contentId: "<sig@x>" }),
    ];

    expect(findOrphanedCidRefs(makeEmail({ html, attachments }))).toEqual([]);
  });

  it("returns orphaned cid tokens in first-seen order, deduplicated", () => {
    const html = `<img src="cid:logo@x"><img src="cid:missing@x"><img src="cid:missing@x">`;
    const attachments: Attachment[] = [
      makeAttachment({ disposition: "inline", contentId: "<logo@x>" }),
    ];

    expect(findOrphanedCidRefs(makeEmail({ html, attachments }))).toEqual([
      "missing@x",
    ]);
  });

  it("matches cid tokens whether the inline attachment's contentId has brackets or not", () => {
    const html = `<img src="cid:a@x"><img src="cid:b@x">`;
    const attachments: Attachment[] = [
      makeAttachment({ disposition: "inline", contentId: "<a@x>" }),
      makeAttachment({ disposition: "inline", contentId: "b@x" }),
    ];

    expect(findOrphanedCidRefs(makeEmail({ html, attachments }))).toEqual([]);
  });

  it("treats non-inline attachments as non-backing even when they share a contentId", () => {
    const html = `<img src="cid:payload@x">`;
    const attachments: Attachment[] = [
      makeAttachment({ disposition: "attachment", contentId: "<payload@x>" }),
    ];

    expect(findOrphanedCidRefs(makeEmail({ html, attachments }))).toEqual([
      "payload@x",
    ]);
  });

  it("extracts cid tokens from multiple quote styles and attribute contexts", () => {
    const html = `
      <img src="cid:one@x">
      <img src='cid:two@x'>
      <a href="cid:three@x">x</a>
    `;

    expect(findOrphanedCidRefs(makeEmail({ html }))).toEqual([
      "one@x",
      "two@x",
      "three@x",
    ]);
  });
});
