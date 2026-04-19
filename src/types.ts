/**
 * Core types shared across the addressing, parsing, threading, and
 * composition modules. All fields are `readonly` at both the slot and
 * collection level — these records are values, never mutated in place.
 *
 * @module
 */

/**
 * A single email mailbox.
 *
 * `address` is the `local@domain` part; `name` is the optional display
 * name. When present, `name` is a non-empty, trimmed string. Use
 * {@link parseAddress} / {@link parseAddressList} to obtain instances
 * from header strings; {@link formatAddress} to serialize.
 */
export type EmailAddress = {
  /** RFC 5322 display name. When present, guaranteed non-empty and trimmed. */
  readonly name?: string;
  /** `local@domain` part of the mailbox. */
  readonly address: string;
};

/**
 * A MIME part extracted from a parsed email — either an attachment or an
 * inline cid-referenced body part.
 *
 * `content` is present after parsing and may be stripped by callers that
 * persist the payload elsewhere while retaining the metadata. The only
 * function in this library that requires `content` to be present is the
 * forthcoming `createForward`; everything else tolerates `content`
 * being `undefined`.
 *
 * Use {@link isInlineAttachment} to distinguish inline cid-referenced
 * images from user-facing attachments.
 */
export type Attachment = {
  /** Filename as declared in `Content-Disposition` / `Content-Type name=`. */
  readonly filename?: string | undefined;
  /** MIME type, e.g. `image/png`. */
  readonly mimeType: string;
  /** `Content-Disposition` value. Defaults to `"attachment"` when the header is absent. */
  readonly disposition: "attachment" | "inline";
  /** `Content-ID` including angle brackets, e.g. `<logo@example>`. Usually present for inline parts. */
  readonly contentId?: string | undefined;
  /**
   * Byte length of the decoded content at parse time. Remains set to
   * the original length even if `content` is later stripped.
   */
  readonly size: number;
  /**
   * Decoded binary payload. Present after {@link parseMessage}; may be
   * `undefined` once callers have persisted the payload to storage.
   */
  readonly content?: ArrayBuffer | undefined;
};

/**
 * A parsed email in structured form. Produced by {@link parseMessage}.
 *
 * Empty collections are always represented as empty arrays (never
 * `undefined`). `date` is a `Date` when the `Date:` header is
 * parseable, otherwise `undefined`. `headers` preserves every
 * occurrence of each header in order — duplicate `Received:` /
 * `DKIM-Signature:` lines each keep their own entry.
 */
export type ParsedEmail = {
  /** RFC 5322 `Message-ID:` including angle brackets, e.g. `<abc@example.com>`. */
  readonly messageId?: string | undefined;
  /** Single Message-ID referenced in `In-Reply-To:`, including angle brackets. */
  readonly inReplyTo?: string | undefined;
  /** Chronologically ordered Message-IDs from `References:`. Empty when absent. */
  readonly references: readonly string[];
  /** `Subject:` with RFC 2047 encoded-words already decoded. */
  readonly subject?: string | undefined;
  /** First mailbox from `From:`. Group syntax yields the first member. */
  readonly from?: EmailAddress | undefined;
  /** Flattened mailboxes from `To:`. Groups are expanded. */
  readonly to: readonly EmailAddress[];
  /** Flattened mailboxes from `Cc:`. */
  readonly cc: readonly EmailAddress[];
  /** Flattened mailboxes from `Bcc:`. */
  readonly bcc: readonly EmailAddress[];
  /** First mailbox from `Reply-To:`. Full list remains in {@link ParsedEmail.headers}. */
  readonly replyTo?: EmailAddress | undefined;
  /** Parsed `Date:`. `undefined` when the header is absent or unparseable. */
  readonly date?: Date | undefined;
  /** Decoded `text/html` body, when present. */
  readonly html?: string | undefined;
  /** Decoded `text/plain` body, when present. */
  readonly text?: string | undefined;
  /** Both attachments and inline cid-referenced parts, in source order. */
  readonly attachments: readonly Attachment[];
  /**
   * Every header occurrence. Keys are lowercased (`headers.get("Received")`
   * returns `undefined`; use `headers.get("received")`). Values are the
   * raw header values — not RFC 2047 decoded — so they remain suitable
   * for DKIM verification.
   */
  readonly headers: ReadonlyMap<string, readonly string[]>;
};

/**
 * A composed outbound message produced by {@link createReply},
 * {@link createReplyAll}, {@link createForward}, or
 * {@link createDraft}.
 *
 * `raw` contains the RFC 5322 serialized form and is ready to hand to
 * any SMTP-capable transport. It intentionally **excludes** the `Bcc:`
 * header — BCC recipients are exposed only through the structured
 * `bcc` field so callers can drive envelope-level delivery without
 * leaking the BCC list to other recipients.
 */
export type ComposedMessage = {
  /** Freshly generated Message-ID including angle brackets. */
  readonly messageId: string;
  /** Set for replies; omitted for forwards and fresh drafts. */
  readonly inReplyTo?: string | undefined;
  /** Full `References` chain, truncated per {@link buildReferences}'s 20-entry cap. */
  readonly references: readonly string[];
  /** Subject as it will appear on the wire. */
  readonly subject: string;
  /** Sender. */
  readonly from: EmailAddress;
  /** Primary recipients. */
  readonly to: readonly EmailAddress[];
  /** Carbon-copy recipients. */
  readonly cc: readonly EmailAddress[];
  /** BCC recipients. **Never appear in `raw`** — use this field to drive envelope delivery. */
  readonly bcc: readonly EmailAddress[];
  /** HTML body, when present. */
  readonly html?: string | undefined;
  /** Plain-text body, when present. */
  readonly text?: string | undefined;
  /** Attachments copied into the outgoing MIME body. */
  readonly attachments: readonly Attachment[];
  /** RFC 5322 formatted string with CRLF line endings; excludes `Bcc:` — see {@link ComposedMessage.bcc}. */
  readonly raw: string;
};

/**
 * HTML and plain-text body parts for an outgoing message. At least
 * one side should be populated for a sendable message; both-empty is
 * accepted (mostly useful for "quote-only" replies).
 */
export type MessageBody = {
  /** HTML body. */
  readonly html?: string | undefined;
  /** Plain-text body. */
  readonly text?: string | undefined;
};

/** Options for {@link createReply} and {@link createReplyAll}. */
export type ReplyOptions = {
  /** Who the reply is from. */
  readonly from: EmailAddress;
  /** User-authored body that will sit above the quoted original. */
  readonly body: MessageBody;
  /** Addresses to strip from every recipient list (e.g. your own). */
  readonly excludeAddresses?: readonly string[] | undefined;
};

/** Options for {@link createForward}. */
export type ForwardOptions = {
  /** Who the forward is from. */
  readonly from: EmailAddress;
  /** Primary recipients. */
  readonly to: readonly EmailAddress[];
  /** Optional carbon-copy recipients. */
  readonly cc?: readonly EmailAddress[] | undefined;
  /** Optional user note to insert above the forwarded block. */
  readonly body?: MessageBody | undefined;
};

/** Options for {@link createDraft} — a brand-new, non-threaded message. */
export type DraftOptions = {
  /** Who the draft is from. */
  readonly from: EmailAddress;
  /** Primary recipients. Defaults to empty. */
  readonly to?: readonly EmailAddress[] | undefined;
  /** Carbon-copy recipients. Defaults to empty. */
  readonly cc?: readonly EmailAddress[] | undefined;
  /** Blind carbon-copy recipients. Never serialized into `raw`. */
  readonly bcc?: readonly EmailAddress[] | undefined;
  /** Subject. Defaults to empty. */
  readonly subject?: string | undefined;
  /** User-authored body. */
  readonly body?: MessageBody | undefined;
  /** Attachments. Each must carry `content` at serialization time. */
  readonly attachments?: readonly Attachment[] | undefined;
};

/**
 * The subset of {@link ParsedEmail} fields needed to determine thread
 * membership. Extract via {@link extractThreadingHeaders} when you only
 * need to make threading decisions without holding the full record.
 */
export type ThreadingHeaders = {
  readonly messageId?: string | undefined;
  readonly inReplyTo?: string | undefined;
  readonly references: readonly string[];
};

/**
 * A node in a thread tree. Every node has a `messageId` that identifies
 * its position in the conversation; `email` is present when the actual
 * message was available to the threader and absent when JWZ kept the
 * node as a virtual root (a parent referenced by ≥2 children but not
 * present in the input set).
 */
export type ThreadNode = {
  /** The parsed email for this node, or `undefined` for a virtual root. */
  readonly email?: ParsedEmail | undefined;
  /** Message-ID this node represents. Always present, even for virtual roots. */
  readonly messageId: string;
  /** Direct replies to this node, sorted by date (dated first, then ascending). */
  readonly children: readonly ThreadNode[];
};

/**
 * A full conversation — the root of a {@link ThreadNode} tree plus
 * aggregated metadata.
 */
export type Thread = {
  /** Message-ID of the root, used as a stable thread identifier. */
  readonly id: string;
  /** Root node of the conversation tree. */
  readonly root: ThreadNode;
  /** Deduplicated union of every mailbox that appears in any message. */
  readonly participants: readonly EmailAddress[];
  /** Normalized subject of the root (RFC 2047 decoded, prefixes stripped). */
  readonly subject?: string | undefined;
  /** Most recent `Date:` across every message in the thread. */
  readonly lastDate?: Date | undefined;
  /** Count of nodes whose `email` is present (virtual roots excluded). */
  readonly messageCount: number;
};
