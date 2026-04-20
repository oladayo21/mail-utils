/**
 * MIME parsing: an async entry point ({@link parseMessage}) that turns
 * raw email bytes into a structured {@link ParsedEmail}, plus a sync
 * helper ({@link extractThreadingHeaders}) that pulls a narrow subset
 * out of the result.
 *
 * `parseMessage` is the only async function in the library; every other
 * export works on the `ParsedEmail` shape it produces.
 *
 * @module
 */

import PostalMime from "postal-mime";
import type {
  Address as PMAddress,
  Attachment as PMAttachment,
  Email as PMEmail,
  Header as PMHeader,
  Mailbox as PMMailbox,
} from "postal-mime";

import type {
  Attachment,
  EmailAddress,
  ParsedEmail,
  ThreadingHeaders,
} from "./types.ts";

/**
 * Suggested default cap on the combined size of the header block,
 * in bytes. Not applied automatically — pass as
 * {@link ParseMessageOptions.maxHeaderSize} when you want it.
 *
 * Mirrors emailengine's baseline (1 MB). Roomy enough for 10+-hop
 * Received chains and duplicate DKIM-Signatures; tight enough to
 * reject pathological header-stuffing attacks.
 */
export const DEFAULT_MAX_HEADER_SIZE = 1_000_000;

/**
 * Suggested default cap on a single attachment's decoded payload, in
 * bytes. Not applied automatically — pass as
 * {@link ParseMessageOptions.maxAttachmentSize} when you want it.
 *
 * Mirrors emailengine's baseline (5 MB).
 */
export const DEFAULT_MAX_ATTACHMENT_SIZE = 5_000_000;

/**
 * Suggested default cap on a single body part's (html or text) byte
 * length. Not applied automatically — pass as
 * {@link ParseMessageOptions.maxBodySize} when you want it.
 *
 * Mirrors emailengine's baseline (50 MB).
 */
export const DEFAULT_MAX_BODY_SIZE = 50_000_000;

/**
 * Opt-in caps that protect constrained runtimes (Workers, edge
 * functions) from OOMing on a single pathological email.
 *
 * None are enforced by default — set only what you need. `parseMessage`
 * never throws when a cap is exceeded: it strips the over-size payload
 * and preserves the metadata (e.g. `Attachment.size`), so the caller
 * can still see that a part existed and decide how to react.
 *
 * @see {@link DEFAULT_MAX_HEADER_SIZE}
 * @see {@link DEFAULT_MAX_ATTACHMENT_SIZE}
 * @see {@link DEFAULT_MAX_BODY_SIZE}
 */
export type ParseMessageOptions = {
  /** Byte cap for the combined header block; forwarded to postal-mime. */
  readonly maxHeaderSize?: number | undefined;
  /** Byte cap for a single attachment's decoded payload. Over-cap attachments come back with `content` undefined. */
  readonly maxAttachmentSize?: number | undefined;
  /** Byte cap for a single body part (`html` or `text`). Over-cap bodies come back `undefined`. */
  readonly maxBodySize?: number | undefined;
};

function mapMailbox(mailbox: PMMailbox): EmailAddress {
  const trimmed = mailbox.name?.trim();

  if (!trimmed) {
    return { address: mailbox.address };
  }

  return { name: trimmed, address: mailbox.address };
}

function flattenAddresses(list: PMAddress[] | undefined): EmailAddress[] {
  if (!list || list.length === 0) {
    return [];
  }

  const out: EmailAddress[] = [];

  for (const entry of list) {
    if (entry.group) {
      for (const m of entry.group) {
        out.push(mapMailbox(m));
      }

      continue;
    }

    out.push(mapMailbox(entry));
  }

  return out;
}

function firstAddress(
  entry: PMAddress | PMAddress[] | undefined,
): EmailAddress | undefined {
  if (!entry) {
    return undefined;
  }

  if (Array.isArray(entry)) {
    return firstAddress(entry[0]);
  }

  if (entry.group) {
    const first = entry.group[0];

    return first ? mapMailbox(first) : undefined;
  }

  return mapMailbox(entry);
}

function parseReferencesHeader(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw.split(/\s+/).filter((token) => token.length > 0);
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const d = new Date(raw);

  if (Number.isNaN(d.getTime())) {
    return undefined;
  }

  return d;
}

function toArrayBuffer(
  content: ArrayBuffer | Uint8Array | string | undefined,
): ArrayBuffer | undefined {
  if (content === undefined) {
    return undefined;
  }

  if (typeof content === "string") {
    // Defensive: parseMessage forces `attachmentEncoding: "arraybuffer"`,
    // so postal-mime should never deliver a string. If it did we would
    // be about to encode base64-as-bytes and corrupt the attachment
    // silently, so fail loudly instead.
    throw new Error(
      "parseMessage: postal-mime returned string attachment content; expected ArrayBuffer.",
    );
  }

  if (content instanceof Uint8Array) {
    // Copy the view into a dedicated ArrayBuffer. The original .buffer is
    // typed as ArrayBuffer | SharedArrayBuffer; we always return ArrayBuffer.
    const copy = new ArrayBuffer(content.byteLength);

    new Uint8Array(copy).set(content);

    return copy;
  }

  return content;
}

function mapAttachment(
  att: PMAttachment,
  maxAttachmentSize: number | undefined,
): Attachment {
  const content = toArrayBuffer(att.content);
  const size = content?.byteLength ?? 0;
  const disposition: "attachment" | "inline" =
    att.disposition === "inline" ? "inline" : "attachment";
  // Strip oversized payloads rather than throwing — preserves metadata
  // (filename, size) so the caller can surface "attachment too large"
  // without paying the memory cost.
  const keepContent =
    maxAttachmentSize === undefined || size <= maxAttachmentSize;

  return {
    filename: att.filename ?? undefined,
    mimeType: att.mimeType,
    disposition,
    contentId: att.contentId,
    size,
    content: keepContent ? content : undefined,
  };
}

function buildHeaders(list: PMHeader[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();

  if (!list) {
    return map;
  }

  for (const h of list) {
    // postal-mime already lowercases header.key.
    const existing = map.get(h.key);

    if (existing) {
      existing.push(h.value);

      continue;
    }

    map.set(h.key, [h.value]);
  }

  return map;
}

function withinBodySize(
  body: string | undefined,
  cap: number | undefined,
): string | undefined {
  if (body === undefined || cap === undefined) {
    return body;
  }

  // UTF-8 is at most 3 bytes per UTF-16 code unit for the BMP and up
  // to 4 for surrogate pairs — averaged as 3 that's a safe upper
  // bound. Skip the full encode for the common under-cap case so we
  // don't allocate a 50 MB Uint8Array on a 50 MB body just to
  // measure it.
  if (body.length * 3 <= cap) {
    return body;
  }

  const bytes = new TextEncoder().encode(body).byteLength;

  return bytes <= cap ? body : undefined;
}

function toParsedEmail(p: PMEmail, options: ParseMessageOptions): ParsedEmail {
  const maxAttachmentSize = options.maxAttachmentSize;
  const maxBodySize = options.maxBodySize;
  const html = withinBodySize(p.html, maxBodySize);
  const text = withinBodySize(p.text, maxBodySize);

  return {
    messageId: p.messageId,
    inReplyTo: p.inReplyTo,
    references: parseReferencesHeader(p.references),
    subject: p.subject,
    from: firstAddress(p.from),
    to: flattenAddresses(p.to),
    cc: flattenAddresses(p.cc),
    bcc: flattenAddresses(p.bcc),
    replyTo: firstAddress(p.replyTo),
    date: parseDate(p.date),
    html,
    text,
    attachments: (p.attachments ?? []).map((a) =>
      mapAttachment(a, maxAttachmentSize),
    ),
    headers: buildHeaders(p.headers),
  };
}

/**
 * Parse raw MIME bytes into a structured {@link ParsedEmail}.
 *
 * Accepts the email as a string (raw RFC 5322 source) or an
 * `ArrayBuffer` (common when reading from storage or a transport layer).
 * Per-field malformations degrade gracefully: missing fields become
 * `undefined`, empty collections become `[]`, and an unparseable `Date:`
 * header yields `undefined`.
 *
 * Opt-in caps via {@link ParseMessageOptions} protect constrained
 * runtimes from OOMing on pathological input — see
 * {@link DEFAULT_MAX_HEADER_SIZE}, {@link DEFAULT_MAX_ATTACHMENT_SIZE},
 * {@link DEFAULT_MAX_BODY_SIZE} for sensible defaults.
 *
 * @param raw The email source.
 * @param options Optional caps on header / body / attachment size.
 * @returns A structured {@link ParsedEmail}.
 * @throws {Error} When `raw` is not recognizable MIME and `postal-mime`
 * cannot produce a parse tree (corrupt envelope, truncated multipart,
 * etc.), or when `options.maxHeaderSize` is set and the header block
 * exceeds it (postal-mime enforces). Per-field issues do **not** throw.
 *
 * @example
 * ```ts
 * import { parseMessage, DEFAULT_MAX_ATTACHMENT_SIZE } from "@oflabs/email-utils";
 *
 * declare const rawEml: string;
 * const email = await parseMessage(rawEml, {
 *   maxAttachmentSize: DEFAULT_MAX_ATTACHMENT_SIZE,
 * });
 * ```
 */
export async function parseMessage(
  raw: string | ArrayBuffer,
  options: ParseMessageOptions = {},
): Promise<ParsedEmail> {
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: "arraybuffer",
    ...(options.maxHeaderSize !== undefined
      ? { maxHeadersSize: options.maxHeaderSize }
      : {}),
  });

  return toParsedEmail(parsed, options);
}

/**
 * Pull the three threading-relevant fields out of a {@link ParsedEmail}.
 *
 * Useful during live ingestion when you only need to determine thread
 * membership and want to avoid holding a reference to the full record.
 *
 * @param email A parsed email.
 * @returns The `messageId`, `inReplyTo`, and `references` fields.
 *
 * @example
 * ```ts
 * const headers = extractThreadingHeaders(email);
 * // { messageId: "<abc@x>", inReplyTo: "<parent@x>", references: ["<root@x>", "<parent@x>"] }
 * ```
 */
export function extractThreadingHeaders(
  email: ParsedEmail,
): ThreadingHeaders {
  return {
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
  };
}
