import { describe, expect, it } from "vitest";

import { extractThreadingHeaders, parseMessage } from "./parsing.ts";

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
