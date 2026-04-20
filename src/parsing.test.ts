import { describe, expect, it } from "vitest";

import { createForward } from "./composition.ts";
import {
  DEFAULT_MAX_ATTACHMENT_SIZE,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_MAX_HEADER_SIZE,
  extractThreadingHeaders,
  parseMessage,
} from "./parsing.ts";

function eml(lines: ReadonlyArray<string>): string {
  return lines.join("\r\n");
}

describe("parseMessage — plain text", () => {
  it("parses a minimal text-only email", async () => {
    const raw = eml([
      "From: Ada <ada@example.com>",
      "To: grace@example.com",
      "Subject: Hello",
      "Message-ID: <abc@example.com>",
      "Date: Mon, 19 Apr 2026 12:00:00 +0000",
      "",
      "Body text here.",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.subject).toBe("Hello");
    expect(email.from).toEqual({ name: "Ada", address: "ada@example.com" });
    expect(email.to).toEqual([{ address: "grace@example.com" }]);
    expect(email.text?.trim()).toBe("Body text here.");
    expect(email.html).toBeUndefined();
    expect(email.messageId).toBe("<abc@example.com>");
    expect(email.date instanceof Date).toBe(true);
    expect(email.date?.toISOString()).toBe("2026-04-19T12:00:00.000Z");
  });
});

describe("parseMessage — empty-collection invariants", () => {
  it("returns empty arrays for missing to/cc/bcc/references/attachments", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Lonely",
      "",
      "Body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.to).toEqual([]);
    expect(email.cc).toEqual([]);
    expect(email.bcc).toEqual([]);
    expect(email.references).toEqual([]);
    expect(email.attachments).toEqual([]);
  });
});

describe("parseMessage — threading headers", () => {
  it("splits the References header on whitespace", async () => {
    const raw = eml([
      "From: ada@example.com",
      "To: grace@example.com",
      "Subject: Re: Hi",
      "In-Reply-To: <parent@example.com>",
      "References: <root@example.com> <middle@example.com> <parent@example.com>",
      "",
      "reply body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.inReplyTo).toBe("<parent@example.com>");
    expect(email.references).toEqual([
      "<root@example.com>",
      "<middle@example.com>",
      "<parent@example.com>",
    ]);
  });

  it("handles folded References across multiple lines", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Re: Hi",
      "References: <root@example.com>",
      "\t<middle@example.com>",
      " <parent@example.com>",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.references).toEqual([
      "<root@example.com>",
      "<middle@example.com>",
      "<parent@example.com>",
    ]);
  });

  it("handles a single-token References header", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Re: Hi",
      "References: <only@example.com>",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.references).toEqual(["<only@example.com>"]);
  });

  it("preserves every token of a very long References chain", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `<id${i}@example.com>`);
    const raw = eml([
      "From: ada@example.com",
      "Subject: Re: long",
      `References: ${ids.join(" ")}`,
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.references).toHaveLength(50);
    expect(email.references[0]).toBe("<id0@example.com>");
    expect(email.references[49]).toBe("<id49@example.com>");
  });
});

describe("parseMessage — dates", () => {
  it("returns undefined for an unparseable Date header", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Bad date",
      "Date: not a real date at all",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.date).toBeUndefined();
  });

  it("returns undefined when the Date header is absent", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: No date",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.date).toBeUndefined();
  });
});

describe("parseMessage — headers map", () => {
  it("preserves every Received header in order across a long chain", async () => {
    const hops = Array.from(
      { length: 12 },
      (_, i) => `Received: from hop${12 - i}.example.com by hop${11 - i}.example.com`,
    );
    const raw = eml([
      ...hops,
      "From: ada@example.com",
      "Subject: Many hops",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    const received = email.headers.get("received");

    expect(received).toHaveLength(12);
    expect(received?.[0]).toContain("hop12.example.com");
    expect(received?.[11]).toContain("hop1.example.com");
  });

  it("preserves multiple DKIM-Signature headers", async () => {
    const raw = eml([
      "DKIM-Signature: v=1; a=rsa-sha256; d=original.example.com",
      "DKIM-Signature: v=1; a=rsa-sha256; d=listserv.example.com",
      "From: ada@example.com",
      "Subject: Signed twice",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    const sigs = email.headers.get("dkim-signature");

    expect(sigs).toHaveLength(2);
    expect(sigs?.[0]).toContain("original.example.com");
    expect(sigs?.[1]).toContain("listserv.example.com");
  });

  it("stores header keys lowercased", async () => {
    const raw = eml([
      "X-Custom-Header: value",
      "From: ada@example.com",
      "Subject: Hi",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.headers.get("x-custom-header")).toEqual(["value"]);
    expect(email.headers.has("X-Custom-Header")).toBe(false);
  });
});

describe("parseMessage — addresses", () => {
  it("flattens group syntax in To", async () => {
    const raw = eml([
      "From: ada@example.com",
      "To: Team: alice@example.com, bob@example.com;",
      "Subject: Group",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.to).toEqual([
      { address: "alice@example.com" },
      { address: "bob@example.com" },
    ]);
  });

  it("decodes RFC 2047 Q-encoded display names in From", async () => {
    const raw = eml([
      "From: =?UTF-8?Q?Ada_Lovelace?= <ada@example.com>",
      "Subject: Encoded",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.from).toEqual({
      name: "Ada Lovelace",
      address: "ada@example.com",
    });
  });

  it("decodes RFC 2047 B-encoded display names in From (non-ASCII)", async () => {
    // Base64 of "Äda Lovelace" (UTF-8): "w4RkYSBMb3ZlbGFjZQ=="
    const raw = eml([
      "From: =?UTF-8?B?w4RkYSBMb3ZlbGFjZQ==?= <ada@example.com>",
      "Subject: Encoded",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.from).toEqual({
      name: "Äda Lovelace",
      address: "ada@example.com",
    });
  });

  it("picks the first member when From uses group syntax", async () => {
    const raw = eml([
      "From: Team: ada@example.com, grace@example.com;",
      "Subject: Group From",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.from).toEqual({ address: "ada@example.com" });
  });

  it("picks the first replyTo when multiple are present", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Reply-To: primary@example.com, secondary@example.com",
      "Subject: Reply",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.replyTo).toEqual({ address: "primary@example.com" });
  });
});

describe("parseMessage — HTML and multipart", () => {
  it("extracts HTML when present", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: HTML",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Hello <b>world</b></p>",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.html?.trim()).toContain("<p>Hello <b>world</b></p>");
    expect(email.text).toBeUndefined();
  });

  it("extracts both html and text from multipart/alternative", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Multipart",
      'Content-Type: multipart/alternative; boundary="boundary42"',
      "",
      "--boundary42",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello world",
      "",
      "--boundary42",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Hello world</p>",
      "",
      "--boundary42--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.text?.trim()).toBe("Hello world");
    expect(email.html?.trim()).toContain("<p>Hello world</p>");
  });
});

describe("parseMessage — attachments", () => {
  it("extracts a binary attachment with size and content", async () => {
    // Base64 for 5 bytes: "hello"
    const raw = eml([
      "From: ada@example.com",
      "Subject: With attachment",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "See attached.",
      "",
      "--b",
      "Content-Type: application/octet-stream; name=hello.bin",
      "Content-Disposition: attachment; filename=hello.bin",
      "Content-Transfer-Encoding: base64",
      "",
      "aGVsbG8=",
      "",
      "--b--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.attachments).toHaveLength(1);
    const att = email.attachments[0]!;

    expect(att.filename).toBe("hello.bin");
    expect(att.mimeType).toBe("application/octet-stream");
    expect(att.disposition).toBe("attachment");
    expect(att.size).toBe(5);
    expect(att.content).toBeInstanceOf(ArrayBuffer);

    const bytes = new Uint8Array(att.content!);

    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it("leaves filename undefined when no filename parameter is declared", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Nameless",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "See attached.",
      "",
      "--b",
      "Content-Type: application/octet-stream",
      "Content-Disposition: attachment",
      "Content-Transfer-Encoding: base64",
      "",
      "aGVsbG8=",
      "",
      "--b--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]?.filename).toBeUndefined();
    expect(email.attachments[0]?.mimeType).toBe("application/octet-stream");
  });

  it("surfaces both a real attachment and an inline cid image in one multipart/mixed", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Combined",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/related; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/html",
      "",
      '<p>hi <img src="cid:logo@example"></p>',
      "",
      "--inner",
      "Content-Type: image/png",
      "Content-Disposition: inline",
      "Content-ID: <logo@example>",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgo=",
      "",
      "--inner--",
      "",
      "--outer",
      "Content-Type: application/pdf; name=report.pdf",
      "Content-Disposition: attachment; filename=report.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "",
      "--outer--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.attachments).toHaveLength(2);

    const inline = email.attachments.find((a) => a.disposition === "inline");
    const attached = email.attachments.find((a) => a.disposition === "attachment");

    expect(inline?.contentId).toBe("<logo@example>");
    expect(attached?.filename).toBe("report.pdf");
    expect(attached?.mimeType).toBe("application/pdf");
  });

  it("defaults disposition to 'attachment' when the header is absent", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: With attachment",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "See attached.",
      "",
      "--b",
      "Content-Type: application/octet-stream; name=hello.bin",
      "Content-Transfer-Encoding: base64",
      "",
      "aGVsbG8=",
      "",
      "--b--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.attachments[0]?.disposition).toBe("attachment");
  });

  it("marks cid-referenced inline images with disposition 'inline' and contentId", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Inline image",
      'Content-Type: multipart/related; boundary="b"',
      "",
      "--b",
      "Content-Type: text/html",
      "",
      '<img src="cid:logo@example">',
      "",
      "--b",
      "Content-Type: image/png",
      "Content-Disposition: inline",
      "Content-ID: <logo@example>",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgo=",
      "",
      "--b--",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.attachments).toHaveLength(1);
    const att = email.attachments[0]!;

    expect(att.disposition).toBe("inline");
    expect(att.contentId).toBe("<logo@example>");
  });
});

describe("parseMessage — accepts ArrayBuffer input", () => {
  it("handles ArrayBuffer as well as string", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Buffer",
      "",
      "body",
      "",
    ]);

    const buffer = new TextEncoder().encode(raw).buffer as ArrayBuffer;

    const email = await parseMessage(buffer);

    expect(email.subject).toBe("Buffer");
  });
});

describe("parseMessage — missing Message-ID", () => {
  it("returns undefined messageId when the header is absent", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Anonymous",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.messageId).toBeUndefined();
  });
});

describe("extractThreadingHeaders", () => {
  it("pulls the three threading fields out of a ParsedEmail", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Re: Hi",
      "Message-ID: <abc@example.com>",
      "In-Reply-To: <parent@example.com>",
      "References: <root@example.com> <parent@example.com>",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);
    const headers = extractThreadingHeaders(email);

    expect(headers).toEqual({
      messageId: "<abc@example.com>",
      inReplyTo: "<parent@example.com>",
      references: ["<root@example.com>", "<parent@example.com>"],
    });
  });

  it("returns empty references when none are present", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: New thread",
      "Message-ID: <new@example.com>",
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);
    const headers = extractThreadingHeaders(email);

    expect(headers.references).toEqual([]);
    expect(headers.messageId).toBe("<new@example.com>");
    expect(headers.inReplyTo).toBeUndefined();
  });

  it("round-trips References tokens through the raw header value", async () => {
    const tokens = [
      "<a@example.com>",
      "<b@example.com>",
      "<c@example.com>",
    ];
    const raw = eml([
      "From: ada@example.com",
      "Subject: Re: round",
      `References: ${tokens.join(" ")}`,
      "",
      "body",
      "",
    ]);

    const email = await parseMessage(raw);

    expect(email.references.join(" ")).toBe(tokens.join(" "));
  });
});

describe("parseMessage — defensive caps", () => {
  it("exports sensible default constants", () => {
    expect(DEFAULT_MAX_HEADER_SIZE).toBe(1_000_000);
    expect(DEFAULT_MAX_ATTACHMENT_SIZE).toBe(5_000_000);
    expect(DEFAULT_MAX_BODY_SIZE).toBe(50_000_000);
  });

  it("returns the full body and attachment when no caps are set", async () => {
    const body = "a".repeat(4096);
    const attachmentBody = "b".repeat(2048);
    const raw = [
      "From: ada@example.com",
      "Subject: Plain",
      "Content-Type: multipart/mixed; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      body,
      "--BOUND",
      'Content-Type: application/octet-stream; name="data.bin"',
      'Content-Disposition: attachment; filename="data.bin"',
      "",
      attachmentBody,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw);

    expect(email.text?.trim()).toBe(body);
    expect(email.attachments[0]?.content).toBeDefined();
  });

  it("strips body parts whose UTF-8 byte length exceeds maxBodySize", async () => {
    const body = "hello world";
    const raw = eml([
      "From: ada@example.com",
      "Subject: Big",
      "",
      body,
      "",
    ]);

    const email = await parseMessage(raw, { maxBodySize: 3 });

    // Over-cap body is stripped; metadata (subject, from) survives.
    expect(email.text).toBeUndefined();
    expect(email.subject).toBe("Big");
  });

  it("keeps body parts whose UTF-8 byte length is within maxBodySize", async () => {
    const raw = eml([
      "From: ada@example.com",
      "Subject: Ok",
      "",
      "tiny",
      "",
    ]);

    const email = await parseMessage(raw, { maxBodySize: 1024 });

    expect(email.text?.trim()).toBe("tiny");
  });

  it("counts body size in UTF-8 bytes, not characters", async () => {
    // "£" is 2 bytes in UTF-8, 1 code unit in JS. "£££" = 6 bytes, 3 chars.
    const body = "£££";
    const raw = eml([
      "From: ada@example.com",
      "Subject: Utf",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      body,
      "",
    ]);

    // A cap of 4 (bytes) should strip, even though length is 3.
    const over = await parseMessage(raw, { maxBodySize: 4 });

    expect(over.text).toBeUndefined();

    // A cap of 8 (bytes) should keep.
    const under = await parseMessage(raw, { maxBodySize: 8 });

    expect(under.text?.trim()).toBe(body);
  });

  it("drops attachment content but preserves metadata when over maxAttachmentSize", async () => {
    const attachmentBody = "x".repeat(1024);
    const raw = [
      "From: ada@example.com",
      "Subject: Big attachment",
      "Content-Type: multipart/mixed; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      "note",
      "--BOUND",
      'Content-Type: application/octet-stream; name="data.bin"',
      'Content-Disposition: attachment; filename="data.bin"',
      "",
      attachmentBody,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw, { maxAttachmentSize: 256 });
    const att = email.attachments[0];

    expect(att).toBeDefined();
    expect(att?.filename).toBe("data.bin");
    expect(att?.size).toBeGreaterThan(256);
    expect(att?.content).toBeUndefined();
    // A later createForward would throw on this attachment, which is
    // the point — caller opts in and inherits the contract.
  });

  it("keeps attachment content when within maxAttachmentSize", async () => {
    const attachmentBody = "x".repeat(128);
    const raw = [
      "From: ada@example.com",
      "Subject: Small attachment",
      "Content-Type: multipart/mixed; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      "note",
      "--BOUND",
      'Content-Type: application/octet-stream; name="data.bin"',
      'Content-Disposition: attachment; filename="data.bin"',
      "",
      attachmentBody,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw, { maxAttachmentSize: 1024 });

    expect(email.attachments[0]?.content).toBeDefined();
    expect(email.attachments[0]?.size).toBeGreaterThanOrEqual(128);
    expect(email.attachments[0]?.size).toBeLessThanOrEqual(1024);
  });

  it("applies maxBodySize independently to html and text branches", async () => {
    // Short text, very long html. The cap drops html but keeps text.
    const shortText = "short";
    const longHtml = `<p>${"x".repeat(2048)}</p>`;
    const raw = [
      "From: ada@example.com",
      "Subject: Mixed",
      "Content-Type: multipart/alternative; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      shortText,
      "--BOUND",
      "Content-Type: text/html",
      "",
      longHtml,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw, { maxBodySize: 256 });

    expect(email.text?.trim()).toBe(shortText);
    expect(email.html).toBeUndefined();

    // Flip the sides: short html, long text → text stripped, html kept.
    const shortHtml = "<p>hi</p>";
    const longText = "y".repeat(2048);
    const raw2 = [
      "From: ada@example.com",
      "Subject: Mixed",
      "Content-Type: multipart/alternative; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      longText,
      "--BOUND",
      "Content-Type: text/html",
      "",
      shortHtml,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email2 = await parseMessage(raw2, { maxBodySize: 256 });

    expect(email2.text).toBeUndefined();
    expect(email2.html).toContain("<p>hi</p>");
  });

  it("preserves every attachment metadata field when content is stripped", async () => {
    const attachmentBody = "z".repeat(1024);
    const raw = [
      "From: ada@example.com",
      "Subject: inline big",
      "Content-Type: multipart/related; boundary=BOUND",
      "",
      "--BOUND",
      'Content-Type: text/html; charset="utf-8"',
      "",
      '<p><img src="cid:logo@x"></p>',
      "--BOUND",
      'Content-Type: image/png; name="logo.png"',
      'Content-Disposition: inline; filename="logo.png"',
      "Content-ID: <logo@x>",
      "",
      attachmentBody,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw, { maxAttachmentSize: 256 });
    const att = email.attachments[0]!;

    expect(att.filename).toBe("logo.png");
    expect(att.mimeType).toBe("image/png");
    expect(att.disposition).toBe("inline");
    expect(att.contentId).toBe("<logo@x>");
    expect(att.size).toBeGreaterThan(256);
    expect(att.content).toBeUndefined();
  });

  it("createForward surfaces the opt-in contract: stripped attachments throw as caller error", async () => {
    const attachmentBody = "x".repeat(1024);
    const raw = [
      "From: ada@example.com",
      "To: grace@example.com",
      "Subject: Heavy",
      "Content-Type: multipart/mixed; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/plain",
      "",
      "note",
      "--BOUND",
      'Content-Type: application/octet-stream; name="data.bin"',
      'Content-Disposition: attachment; filename="data.bin"',
      "",
      attachmentBody,
      "--BOUND--",
      "",
    ].join("\r\n");

    const email = await parseMessage(raw, { maxAttachmentSize: 256 });

    expect(() =>
      createForward(email, {
        from: { address: "bob@example.com" },
        to: [{ address: "carol@example.com" }],
      }),
    ).toThrow(/createForward requires Attachment.content/);
  });

  it("forwards maxHeaderSize to postal-mime, which throws on over-cap headers", async () => {
    const padding = "a".repeat(200);
    const raw = eml([
      "From: ada@example.com",
      `X-Big: ${padding}`,
      "Subject: Hi",
      "",
      "body",
      "",
    ]);

    // Tiny cap — postal-mime rejects the header block.
    await expect(parseMessage(raw, { maxHeaderSize: 10 })).rejects.toThrow();
  });
});
