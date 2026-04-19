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
 * The subset of {@link ParsedEmail} fields needed to determine thread
 * membership. Extract via {@link extractThreadingHeaders} when you only
 * need to make threading decisions without holding the full record.
 */
export type ThreadingHeaders = {
  readonly messageId?: string | undefined;
  readonly inReplyTo?: string | undefined;
  readonly references: readonly string[];
};
