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

function mapAttachment(att: PMAttachment): Attachment {
  const content = toArrayBuffer(att.content);
  const size = content?.byteLength ?? 0;
  const disposition: "attachment" | "inline" =
    att.disposition === "inline" ? "inline" : "attachment";

  return {
    filename: att.filename ?? undefined,
    mimeType: att.mimeType,
    disposition,
    contentId: att.contentId,
    size,
    content,
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

function toParsedEmail(p: PMEmail): ParsedEmail {
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
    html: p.html,
    text: p.text,
    attachments: (p.attachments ?? []).map(mapAttachment),
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
 * @param raw The email source.
 * @returns A structured {@link ParsedEmail}.
 * @throws {Error} When `raw` is not recognizable MIME and `postal-mime`
 * cannot produce a parse tree (corrupt envelope, truncated multipart,
 * etc.). Per-field issues do **not** throw.
 *
 * @example
 * ```ts
 * import { parseMessage } from "@oflabs/mail-utils";
 *
 * declare const rawEml: string;
 * const email = await parseMessage(rawEml);
 * const { to, from, subject } = email;
 * ```
 */
export async function parseMessage(
  raw: string | ArrayBuffer,
): Promise<ParsedEmail> {
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: "arraybuffer",
  });

  return toParsedEmail(parsed);
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
