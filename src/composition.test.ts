import { describe, expect, it } from "vitest";

import {
  buildReferences,
  createDraft,
  createForward,
  createReply,
  createReplyAll,
  generateMessageId,
  quoteBody,
} from "./composition.ts";
import { parseMessage } from "./parsing.ts";
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
  const content = new ArrayBuffer(5);

  new Uint8Array(content).set([104, 105, 33, 33, 33]); // "hi!!!"

  return {
    mimeType: "text/plain",
    disposition: "attachment",
    size: 5,
    content,
    ...overrides,
  };
}

describe("re-exports from internal modules", () => {
  it("generateMessageId delegates", () => {
    expect(generateMessageId("example.com")).toMatch(/@example\.com>$/);
  });

  it("buildReferences delegates", () => {
    const email = makeEmail({
      messageId: "<a@x>",
      references: [],
    });

    expect(buildReferences(email)).toEqual(["<a@x>"]);
  });

  it("quoteBody delegates", () => {
    const email = makeEmail({
      from: { address: "ada@x" },
      text: "hi",
    });

    const result = quoteBody(email);

    expect(result.text).toContain("ada@x wrote:");
    expect(result.html).toContain("<blockquote>");
  });
});

describe("createReply", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("replies to the original sender only", () => {
    const incoming = makeEmail({
      messageId: "<abc@example.com>",
      from: { address: "ada@example.com" },
      to: [{ address: "other@example.com" }],
      subject: "Hello",
      text: "hi there",
      date: new Date("2026-04-19T12:00:00Z"),
    });

    const reply = createReply(incoming, {
      from,
      body: { text: "Thanks!" },
    });

    expect(reply.to).toEqual([{ address: "ada@example.com" }]);
    expect(reply.cc).toEqual([]);
    expect(reply.subject).toBe("Re: Hello");
    expect(reply.inReplyTo).toBe("<abc@example.com>");
    expect(reply.references).toEqual(["<abc@example.com>"]);
    expect(reply.text).toContain("Thanks!");
    expect(reply.text).toContain("> hi there");
  });

  it("prefers replyTo over from when present", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      replyTo: { address: "support@x" },
      subject: "Hi",
      text: "body",
    });

    const reply = createReply(incoming, { from, body: { text: "ok" } });

    expect(reply.to).toEqual([{ address: "support@x" }]);
  });

  it("does not add Re: when the subject already has a reply prefix", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Re: Hi",
      text: "body",
    });

    const reply = createReply(incoming, { from, body: { text: "ok" } });

    expect(reply.subject).toBe("Re: Hi");
  });

  it("strips excluded addresses from the recipient list", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "me@example.com" },
      subject: "Hi",
      text: "body",
    });

    const reply = createReply(incoming, {
      from,
      body: { text: "ok" },
      excludeAddresses: ["ME@example.com"],
    });

    expect(reply.to).toEqual([]);
  });

  it("omits In-Reply-To when the original message-id is a synthesized orphan", () => {
    const incoming = makeEmail({
      messageId: "<orphan.0123456789abcdef@local>",
      from: { address: "ada@x" },
      subject: "Hi",
      text: "body",
    });

    const reply = createReply(incoming, { from, body: { text: "ok" } });

    expect(reply.inReplyTo).toBeUndefined();
  });
});

describe("createReplyAll", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("replies to sender + original To, deduped; original Cc becomes Cc", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@example.com" },
      to: [{ address: "grace@example.com" }, { address: "bob@example.com" }],
      cc: [{ address: "charlie@example.com" }],
      subject: "Hi",
      text: "body",
    });

    const reply = createReplyAll(incoming, { from, body: { text: "ok" } });

    expect(reply.to.map((a) => a.address).sort()).toEqual([
      "ada@example.com",
      "bob@example.com",
      "grace@example.com",
    ]);
    expect(reply.cc.map((a) => a.address)).toEqual(["charlie@example.com"]);
  });

  it("removes To entries from the Cc list after dedup", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@example.com" },
      to: [{ address: "grace@example.com" }],
      cc: [{ address: "grace@example.com" }, { address: "bob@example.com" }],
      subject: "Hi",
      text: "body",
    });

    const reply = createReplyAll(incoming, { from, body: { text: "ok" } });

    expect(reply.cc.map((a) => a.address)).toEqual(["bob@example.com"]);
  });

  it("strips excluded addresses from both To and Cc", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@example.com" },
      to: [{ address: "me@example.com" }],
      cc: [{ address: "ME@example.com" }],
      subject: "Hi",
      text: "body",
    });

    const reply = createReplyAll(incoming, {
      from,
      body: { text: "ok" },
      excludeAddresses: ["me@example.com"],
    });

    expect(reply.to.map((a) => a.address)).toEqual(["ada@example.com"]);
    expect(reply.cc).toEqual([]);
  });

  it("allows the recipient set to end up empty", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "me@example.com" },
      subject: "Hi",
      text: "body",
    });

    const reply = createReplyAll(incoming, {
      from,
      body: { text: "ok" },
      excludeAddresses: ["me@example.com"],
    });

    expect(reply.to).toEqual([]);
    expect(reply.cc).toEqual([]);
  });
});

describe("createForward", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("adds Fwd: prefix, copies attachments, preserves References", () => {
    const original = makeEmail({
      messageId: "<abc@example.com>",
      from: { address: "ada@example.com" },
      subject: "Quarterly plan",
      text: "see attached",
      references: ["<root@example.com>"],
      attachments: [makeAttachment({ filename: "plan.pdf" })],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "colleague@example.com" }],
    });

    expect(forwarded.subject).toBe("Fwd: Quarterly plan");
    expect(forwarded.inReplyTo).toBeUndefined();
    expect(forwarded.references).toEqual([
      "<root@example.com>",
      "<abc@example.com>",
    ]);
    expect(forwarded.attachments).toHaveLength(1);
    expect(forwarded.attachments[0]?.filename).toBe("plan.pdf");
    expect(forwarded.text).toContain("---------- Forwarded message ----------");
    expect(forwarded.text).toContain("ada@example.com");
  });

  it("does not double-add Fwd: when the subject already has a forward prefix", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Fwd: Quarterly",
      attachments: [],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "colleague@x" }],
    });

    expect(forwarded.subject).toBe("Fwd: Quarterly");
  });

  it("throws when any attachment is missing content", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      attachments: [
        {
          mimeType: "application/pdf",
          disposition: "attachment",
          size: 1000,
          filename: "plan.pdf",
          content: undefined,
        },
      ],
    });

    expect(() =>
      createForward(original, { from, to: [{ address: "c@x" }] }),
    ).toThrow(/createForward requires Attachment\.content/);
  });
});

describe("createDraft", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("creates a fresh outbound message with no threading context", () => {
    const draft = createDraft({
      from,
      to: [{ address: "friend@example.com" }],
      subject: "Hello",
      body: { text: "Hi there!" },
    });

    expect(draft.inReplyTo).toBeUndefined();
    expect(draft.references).toEqual([]);
    expect(draft.subject).toBe("Hello");
    expect(draft.to).toEqual([{ address: "friend@example.com" }]);
    expect(draft.messageId).toMatch(/@example\.com>$/);
  });

  it("defaults subject to empty string", () => {
    const draft = createDraft({ from });

    expect(draft.subject).toBe("");
  });

  it("carries attachments through", () => {
    const draft = createDraft({
      from,
      to: [{ address: "friend@x" }],
      attachments: [makeAttachment({ filename: "a.bin" })],
    });

    expect(draft.attachments).toHaveLength(1);
    expect(draft.attachments[0]?.filename).toBe("a.bin");
  });

  it("accepts bcc in the structured field", () => {
    const draft = createDraft({
      from,
      to: [{ address: "a@x" }],
      bcc: [{ address: "archive@x" }],
    });

    expect(draft.bcc).toEqual([{ address: "archive@x" }]);
  });
});

describe("Bcc never leaks into raw", () => {
  const from = { address: "me@example.com" };

  it("createDraft.raw does not contain Bcc: header", () => {
    const draft = createDraft({
      from,
      to: [{ address: "a@example.com" }],
      bcc: [{ address: "archive@example.com" }],
      subject: "Hi",
      body: { text: "hello" },
    });

    expect(draft.raw).not.toMatch(/^Bcc:/im);
    expect(draft.raw).not.toContain("archive@example.com");
  });

  it("createReply.raw does not contain Bcc: header", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Hi",
      text: "body",
    });

    const reply = createReply(incoming, {
      from,
      body: { text: "ok" },
    });

    expect(reply.raw).not.toMatch(/^Bcc:/im);
  });

  it("createReplyAll.raw does not contain Bcc: header", () => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      to: [{ address: "grace@x" }],
      subject: "Hi",
      text: "body",
    });

    const reply = createReplyAll(incoming, {
      from,
      body: { text: "ok" },
    });

    expect(reply.raw).not.toMatch(/^Bcc:/im);
  });

  it("createForward.raw does not contain Bcc: header", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Hi",
      attachments: [],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "c@x" }],
    });

    expect(forwarded.raw).not.toMatch(/^Bcc:/im);
  });
});

describe("raw round-trips through parseMessage", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("createDraft → parse preserves headers and body", async () => {
    const draft = createDraft({
      from,
      to: [{ address: "grace@example.com" }],
      subject: "Hello",
      body: { text: "Hi Grace!" },
    });

    const parsed = await parseMessage(draft.raw);

    expect(parsed.messageId).toBe(draft.messageId);
    expect(parsed.subject).toBe("Hello");
    expect(parsed.from?.address).toBe("me@example.com");
    expect(parsed.to[0]?.address).toBe("grace@example.com");
    expect(parsed.text?.trim()).toBe("Hi Grace!");
  });

  it("createReply → parse preserves threading headers", async () => {
    const incoming = makeEmail({
      messageId: "<abc@example.com>",
      from: { address: "ada@example.com" },
      subject: "Hi",
      text: "original body",
      references: ["<root@example.com>"],
    });

    const reply = createReply(incoming, { from, body: { text: "Thanks." } });
    const parsed = await parseMessage(reply.raw);

    expect(parsed.subject).toBe("Re: Hi");
    expect(parsed.inReplyTo).toBe("<abc@example.com>");
    expect(parsed.references).toEqual([
      "<root@example.com>",
      "<abc@example.com>",
    ]);
  });

  it("createForward → parse preserves attachment metadata and content", async () => {
    const content = new ArrayBuffer(5);

    new Uint8Array(content).set([104, 105, 33, 33, 33]); // "hi!!!"

    const original = makeEmail({
      messageId: "<abc@example.com>",
      from: { address: "ada@example.com" },
      subject: "Quarterly plan",
      text: "see attached",
      attachments: [
        {
          filename: "plan.bin",
          mimeType: "application/octet-stream",
          disposition: "attachment",
          size: 5,
          content,
        },
      ],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "colleague@example.com" }],
    });

    const parsed = await parseMessage(forwarded.raw);

    expect(parsed.subject).toBe("Fwd: Quarterly plan");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe("plan.bin");
    expect(parsed.attachments[0]?.size).toBe(5);
  });
});

describe("multi-language Re: / Fwd: prefix detection", () => {
  const from = { address: "me@example.com" };

  it.each([
    ["Re: Hi"],
    ["RE: Hi"],
    ["Aw: Hallo"],
    ["Rép: Bonjour"],
    ["RV: Hola"],
    ["Sv: Hej"],
    ["Antw: Hallo"],
    ["Odp: Cześć"],
  ])("createReply does not double-add prefix on %s", (subject) => {
    const incoming = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject,
      text: "body",
    });

    const reply = createReply(incoming, { from, body: { text: "ok" } });

    expect(reply.subject).toBe(subject);
  });

  it.each([
    ["Fwd: Plan"],
    ["FWD: Plan"],
    ["Fw: Plan"],
    ["Wg: Plan"],
    ["Tr: Plan"],
    ["Doorst: Plan"],
    ["Vs: Plan"],
  ])("createForward does not double-add prefix on %s", (subject) => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject,
      attachments: [],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "c@x" }],
    });

    expect(forwarded.subject).toBe(subject);
  });
});

describe("createForward body emission", () => {
  const from = { address: "me@example.com" };

  it("does not emit an HTML body when forwarding a text-only original with no user html", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Text only",
      text: "plain content",
      attachments: [],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "c@x" }],
    });

    expect(forwarded.html).toBeUndefined();
    expect(forwarded.text).toBeDefined();
  });

  it("emits both sides when the original had both or the user provided both", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      subject: "Mixed",
      text: "plain",
      html: "<p>html</p>",
      attachments: [],
    });

    const forwarded = createForward(original, {
      from,
      to: [{ address: "c@x" }],
      body: { text: "note", html: "<p>note</p>" },
    });

    expect(forwarded.html).toBeDefined();
    expect(forwarded.text).toBeDefined();
  });
});

describe("createDraft attachment validation", () => {
  const from = { address: "me@example.com" };

  it("throws when any attachment is missing content", () => {
    expect(() =>
      createDraft({
        from,
        to: [{ address: "a@x" }],
        attachments: [
          {
            mimeType: "application/pdf",
            disposition: "attachment",
            size: 100,
            filename: "plan.pdf",
            content: undefined,
          },
        ],
      }),
    ).toThrow(/createDraft requires Attachment\.content/);
  });
});

describe("domainFor validation", () => {
  it("throws when from.address has no `@`", () => {
    expect(() =>
      createDraft({
        from: { address: "localpart-only" },
        to: [{ address: "a@x.com" }],
      }),
    ).toThrow(/must contain a domain/);
  });

  it("throws when from.address ends with `@`", () => {
    expect(() =>
      createDraft({
        from: { address: "ada@" },
        to: [{ address: "a@x.com" }],
      }),
    ).toThrow(/non-empty domain/);
  });
});

describe("raw serialization", () => {
  const from = { name: "Me", address: "me@example.com" };

  it("uses CRLF line endings per SMTP", () => {
    const draft = createDraft({
      from,
      to: [{ address: "a@example.com" }],
      subject: "Hi",
      body: { text: "hello" },
    });

    // Every newline must be CRLF.
    expect(draft.raw).not.toMatch(/(?<!\r)\n/);
  });

  it("includes Message-ID, From, and To headers", () => {
    const draft = createDraft({
      from,
      to: [{ address: "a@example.com" }],
      subject: "Hi",
    });

    expect(draft.raw).toContain(`Message-ID: ${draft.messageId}`);
    expect(draft.raw).toContain("From:");
    expect(draft.raw).toContain("a@example.com");
  });

  it("emits a Date: header (per RFC 5322)", () => {
    const draft = createDraft({
      from,
      to: [{ address: "a@example.com" }],
      subject: "Hi",
      body: { text: "hello" },
    });

    expect(draft.raw).toMatch(/^Date:/im);
  });

  it("includes In-Reply-To and References when set", () => {
    const original = makeEmail({
      messageId: "<abc@x>",
      from: { address: "ada@x" },
      references: ["<root@x>"],
      subject: "Hi",
      text: "hi",
    });

    const reply = createReply(original, {
      from,
      body: { text: "ok" },
    });

    expect(reply.raw).toContain("In-Reply-To: <abc@x>");
    expect(reply.raw).toContain("References: <root@x> <abc@x>");
  });
});
