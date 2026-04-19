import { describe, expect, it } from "vitest";

import {
  buildThreads,
  getThreadId,
  ingestIntoThreads,
  isOrphanId,
  normalizeSubject,
} from "./threading.ts";
import type { ParsedEmail, Thread } from "./types.ts";

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

describe("normalizeSubject (re-export)", () => {
  it("delegates to the internal normalizer", () => {
    expect(normalizeSubject("Re: Fwd: Meeting")).toBe("Meeting");
  });
});

describe("getThreadId", () => {
  it("returns references[0] when References is populated", () => {
    const email = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<root@x>", "<middle@x>", "<a@x>"],
    });

    expect(getThreadId(email)).toBe("<root@x>");
  });

  it("returns inReplyTo when References is empty", () => {
    const email = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
    });

    expect(getThreadId(email)).toBe("<a@x>");
  });

  it("returns messageId when no threading headers are present", () => {
    const email = makeEmail({ messageId: "<solo@x>" });

    expect(getThreadId(email)).toBe("<solo@x>");
  });

  it("synthesizes a deterministic @local id for orphan emails", () => {
    const email = makeEmail({
      from: { address: "ada@x" },
      subject: "Hello",
      date: new Date("2026-04-19T00:00:00Z"),
    });

    const id = getThreadId(email);

    expect(isOrphanId(id)).toBe(true);
    expect(getThreadId(email)).toBe(id); // deterministic
  });
});

describe("buildThreads — basic", () => {
  it("returns [] for empty input", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("threads a single message into a one-message thread", () => {
    const email = makeEmail({
      messageId: "<a@x>",
      subject: "Hello",
      from: { address: "ada@x" },
    });

    const threads = buildThreads([email]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("<a@x>");
    expect(threads[0]?.messageCount).toBe(1);
    expect(threads[0]?.root.email).toBe(email);
  });

  it("threads a straight reply chain", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Hello",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
      subject: "Re: Hello",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const c = makeEmail({
      messageId: "<c@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
      subject: "Re: Hello",
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const threads = buildThreads([a, b, c]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.messageCount).toBe(3);
    expect(threads[0]?.id).toBe("<a@x>");
    expect(threads[0]?.root.children).toHaveLength(1);
    expect(threads[0]?.root.children[0]?.messageId).toBe("<b@x>");
    expect(threads[0]?.root.children[0]?.children[0]?.messageId).toBe("<c@x>");
  });

  it("produces the same tree regardless of input order", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Hello",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
      subject: "Re: Hello",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const c = makeEmail({
      messageId: "<c@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
      subject: "Re: Hello",
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const forward = buildThreads([a, b, c]);
    const backward = buildThreads([c, b, a]);
    const shuffled = buildThreads([b, c, a]);

    expect(forward).toEqual(backward);
    expect(forward).toEqual(shuffled);
  });
});

describe("buildThreads — cycle handling", () => {
  it("does not drop emails when References forms an A↔B cycle", () => {
    // A malformed pair: each email claims the other as its parent.
    const a = makeEmail({
      messageId: "<a@x>",
      inReplyTo: "<b@x>",
      subject: "loop",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      subject: "loop",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const threads = buildThreads([a, b]);

    // Both emails surface somewhere in the output.
    const allIds: string[] = [];

    for (const t of threads) {
      walkIds(t.root, (id) => allIds.push(id));
    }

    expect(allIds).toContain("<a@x>");
    expect(allIds).toContain("<b@x>");
  });
});

function walkIds(
  node: { messageId: string; children: ReadonlyArray<{ messageId: string }> },
  cb: (id: string) => void,
): void {
  cb(node.messageId);

  for (const child of node.children) {
    walkIds(
      child as {
        messageId: string;
        children: ReadonlyArray<{ messageId: string }>;
      },
      cb,
    );
  }
}

describe("buildThreads — branching and intermediate nodes", () => {
  it("threads a two-level fork keeping each branch under the right parent", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const c = makeEmail({
      messageId: "<c@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T02:00:00Z"),
    });
    const dUnderB = makeEmail({
      messageId: "<d@x>",
      inReplyTo: "<b@x>",
      references: ["<root@x>", "<b@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T03:00:00Z"),
    });
    const eUnderC = makeEmail({
      messageId: "<e@x>",
      inReplyTo: "<c@x>",
      references: ["<root@x>", "<c@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T04:00:00Z"),
    });

    const threads = buildThreads([root, b, c, dUnderB, eUnderC]);

    expect(threads).toHaveLength(1);
    const children = threads[0]?.root.children ?? [];

    expect(children.map((c) => c.messageId)).toEqual(["<b@x>", "<c@x>"]);
    expect(children[0]?.children.map((c) => c.messageId)).toEqual(["<d@x>"]);
    expect(children[1]?.children.map((c) => c.messageId)).toEqual(["<e@x>"]);
  });

  it("promotes a single orphan child when its missing parent is known (A → ? → C)", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const c = makeEmail({
      messageId: "<c@x>",
      inReplyTo: "<missing@x>",
      references: ["<a@x>", "<missing@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const threads = buildThreads([a, c]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("<a@x>");
    expect(threads[0]?.root.children.map((c) => c.messageId)).toContain(
      "<c@x>",
    );
  });
});

describe("buildThreads — orphan dedup", () => {
  it("dedupes two orphan emails with identical hashable fields", () => {
    const sharedFrom = { address: "ada@x" };
    const sharedDate = new Date("2026-04-19T00:00:00Z");

    const one = makeEmail({
      from: sharedFrom,
      subject: "Same",
      date: sharedDate,
      text: "body",
    });
    const two = makeEmail({
      from: sharedFrom,
      subject: "Same",
      date: sharedDate,
      text: "body",
    });

    // Both should resolve to the same synthesized id; dedup retains one.
    const threads = buildThreads([one, two]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.messageCount).toBe(1);
  });
});

describe("buildThreads — virtual roots", () => {
  it("keeps ≥2 orphan siblings under a virtual-root container", () => {
    // Both messages reply to a parent we don't have.
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<missing@x>",
      references: ["<missing@x>"],
      subject: "Re: lost thread",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const c = makeEmail({
      messageId: "<c@x>",
      inReplyTo: "<missing@x>",
      references: ["<missing@x>"],
      subject: "Re: lost thread",
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const threads = buildThreads([b, c]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("<missing@x>");
    expect(threads[0]?.root.email).toBeUndefined();
    expect(threads[0]?.root.children).toHaveLength(2);
    expect(threads[0]?.messageCount).toBe(2);
  });

  it("promotes a single orphan child instead of keeping a virtual root", () => {
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<missing@x>",
      references: ["<missing@x>"],
      subject: "Re: lost thread",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const threads = buildThreads([b]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("<b@x>");
    expect(threads[0]?.root.email).toBe(b);
  });
});

describe("buildThreads — dedup by Message-ID", () => {
  it("prefers the richer-content copy of a duplicate Message-ID", () => {
    const poor = makeEmail({
      messageId: "<same@x>",
      subject: "dup",
      text: "plain only",
    });
    const richer = makeEmail({
      messageId: "<same@x>",
      subject: "dup",
      text: "plain",
      html: "<p>html</p>",
    });

    const forward = buildThreads([poor, richer]);
    const backward = buildThreads([richer, poor]);

    expect(forward).toEqual(backward);
    expect(forward[0]?.root.email).toBe(richer);
  });
});

describe("buildThreads — sibling sort", () => {
  it("sorts siblings ascending by date, dated-before-undated, stable otherwise", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const later = makeEmail({
      messageId: "<later@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T03:00:00Z"),
    });
    const earlier = makeEmail({
      messageId: "<earlier@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const undated = makeEmail({
      messageId: "<undated@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
    });

    const threads = buildThreads([undated, later, earlier, root]);
    const order = threads[0]?.root.children.map((c) => c.messageId);

    expect(order).toEqual(["<earlier@x>", "<later@x>", "<undated@x>"]);
  });
});

describe("buildThreads — subject fallback", () => {
  it("groups messages with the same normalized subject within ±7 days", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Planning sync",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      subject: "Re: Planning sync",
      date: new Date("2026-04-20T00:00:00Z"),
    });

    const threads = buildThreads([a, b]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.messageCount).toBe(2);
  });

  it("does NOT group when the subjects differ after normalization", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Planning sync",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      subject: "Budget review",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const threads = buildThreads([a, b]);

    expect(threads).toHaveLength(2);
  });

  it("does NOT group when dates are more than 7 days apart", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Planning sync",
      date: new Date("2026-01-01T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      subject: "Re: Planning sync",
      date: new Date("2026-04-19T00:00:00Z"),
    });

    const threads = buildThreads([a, b]);

    expect(threads).toHaveLength(2);
  });

  it("skips subject-fallback entirely when the candidate has no date", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Planning sync",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      subject: "Re: Planning sync",
    });

    const threads = buildThreads([a, b]);

    expect(threads).toHaveLength(2);
  });
});

describe("buildThreads — participants", () => {
  it("dedupes participants case-insensitively across messages", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Hi",
      from: { name: "Ada", address: "Ada@X.com" },
      to: [{ address: "grace@x.com" }],
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
      subject: "Re: Hi",
      from: { address: "grace@x.com" },
      to: [{ address: "ADA@x.com" }],
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const thread = buildThreads([a, b])[0]!;

    expect(thread.participants.map((p) => p.address.toLowerCase()).sort())
      .toEqual(["ada@x.com", "grace@x.com"]);
  });
});

describe("buildThreads — metadata", () => {
  it("derives participants, lastDate, and normalized subject from the tree", () => {
    const a = makeEmail({
      messageId: "<a@x>",
      subject: "Re: Hello",
      from: { name: "Ada", address: "ada@x" },
      to: [{ address: "grace@x" }],
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const b = makeEmail({
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
      subject: "Re: Re: Hello",
      from: { address: "grace@x" },
      to: [{ address: "ada@x" }, { address: "bob@x" }],
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const thread = buildThreads([a, b])[0]!;

    expect(thread.subject).toBe("Hello");
    expect(thread.lastDate).toEqual(new Date("2026-04-19T02:00:00Z"));
    const addresses = thread.participants.map((p) => p.address).sort();
    expect(addresses).toEqual(["ada@x", "bob@x", "grace@x"]);
  });

  it("orders threads by lastDate descending", () => {
    const old = makeEmail({
      messageId: "<old@x>",
      subject: "Old",
      date: new Date("2026-01-01T00:00:00Z"),
    });
    const recent = makeEmail({
      messageId: "<recent@x>",
      subject: "Recent",
      date: new Date("2026-04-19T00:00:00Z"),
    });

    const threads = buildThreads([old, recent]);

    expect(threads[0]?.id).toBe("<recent@x>");
    expect(threads[1]?.id).toBe("<old@x>");
  });
});

describe("ingestIntoThreads", () => {
  function threadFor(emails: ParsedEmail[]): Thread[] {
    return buildThreads(emails);
  }

  it("creates a new thread when no match exists", () => {
    const fresh = makeEmail({
      messageId: "<new@x>",
      subject: "Brand new",
      date: new Date("2026-04-19T00:00:00Z"),
    });

    const { threads, affectedThreadId } = ingestIntoThreads(fresh, []);

    expect(threads).toHaveLength(1);
    expect(affectedThreadId).toBe("<new@x>");
  });

  it("matches an existing thread by In-Reply-To", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const reply = makeEmail({
      messageId: "<reply@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const { threads, affectedThreadId } = ingestIntoThreads(reply, existing);

    expect(threads).toHaveLength(1);
    expect(affectedThreadId).toBe("<root@x>");
    expect(threads[0]?.messageCount).toBe(2);
    expect(threads[0]?.root.children).toHaveLength(1);
    expect(threads[0]?.root.children[0]?.messageId).toBe("<reply@x>");
  });

  it("matches by References when In-Reply-To does not link directly", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const tangential = makeEmail({
      messageId: "<t@x>",
      references: ["<root@x>", "<missing-intermediate@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const { affectedThreadId } = ingestIntoThreads(tangential, existing);

    expect(affectedThreadId).toBe("<root@x>");
  });

  it("does not mutate the input threads array", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const snapshot = JSON.stringify(existing);
    const reply = makeEmail({
      messageId: "<reply@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    ingestIntoThreads(reply, existing);

    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("inserts into a mid-tree node when parent is not the root", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const mid = makeEmail({
      messageId: "<mid@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });
    const existing = threadFor([root, mid]);
    const child = makeEmail({
      messageId: "<child@x>",
      inReplyTo: "<mid@x>",
      references: ["<root@x>", "<mid@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const { threads } = ingestIntoThreads(child, existing);
    const midNode = threads[0]?.root.children.find(
      (c) => c.messageId === "<mid@x>",
    );

    expect(midNode?.children.map((c) => c.messageId)).toEqual(["<child@x>"]);
    expect(threads[0]?.messageCount).toBe(3);
  });

  it("attaches the new email to the root when the parent is not in the tree", () => {
    // Thread contains only <root@x>. Incoming email's inReplyTo points
    // to an intermediate <phantom@x> that was never ingested, but
    // References also lists <root@x>, so the match succeeds — yet
    // parent lookup fails. Must fall back to attaching under root.
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const reply = makeEmail({
      messageId: "<reply@x>",
      inReplyTo: "<phantom@x>",
      references: ["<root@x>", "<phantom@x>"],
      subject: "Re: Hi",
      date: new Date("2026-04-19T01:00:00Z"),
    });

    const { threads } = ingestIntoThreads(reply, existing);
    const ids = threads[0]?.root.children.map((c) => c.messageId);

    expect(ids).toContain("<reply@x>");
    expect(threads[0]?.messageCount).toBe(2);
  });

  it("subject-fallback requires a date on the candidate", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Planning sync",
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const dateless = makeEmail({
      messageId: "<b@x>",
      subject: "Re: Planning sync",
    });

    const { threads, affectedThreadId } = ingestIntoThreads(
      dateless,
      existing,
    );

    // Should create a new thread — subject fallback cannot fire
    // without a date on the candidate.
    expect(threads).toHaveLength(2);
    expect(affectedThreadId).toBe("<b@x>");
  });

  it("updates participants, lastDate, and messageCount", () => {
    const root = makeEmail({
      messageId: "<root@x>",
      subject: "Hi",
      from: { address: "ada@x" },
      to: [{ address: "grace@x" }],
      date: new Date("2026-04-19T00:00:00Z"),
    });
    const existing = threadFor([root]);
    const reply = makeEmail({
      messageId: "<reply@x>",
      inReplyTo: "<root@x>",
      references: ["<root@x>"],
      subject: "Re: Hi",
      from: { address: "grace@x" },
      to: [{ address: "ada@x" }, { address: "bob@x" }],
      date: new Date("2026-04-19T02:00:00Z"),
    });

    const { threads } = ingestIntoThreads(reply, existing);

    expect(threads[0]?.messageCount).toBe(2);
    expect(threads[0]?.lastDate).toEqual(new Date("2026-04-19T02:00:00Z"));
    const addresses = threads[0]!.participants.map((p) => p.address).sort();
    expect(addresses).toEqual(["ada@x", "bob@x", "grace@x"]);
  });
});
