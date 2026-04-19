/**
 * Compose outbound emails — replies, reply-alls, forwards, and
 * brand-new drafts — producing a structured {@link ComposedMessage}
 * whose `raw` field is wire-ready for any SMTP transport.
 *
 * `raw` intentionally excludes the `Bcc:` header so passing the same
 * serialized form to every recipient does not leak BCC addresses.
 * Callers drive envelope-level BCC delivery via the structured
 * {@link ComposedMessage.bcc} field.
 *
 * @example
 * ```ts
 * import { createReply, parseMessage } from "@oflabs/mail-utils";
 *
 * declare const rawEml: string;
 * const incoming = await parseMessage(rawEml);
 * const reply = createReply(incoming, {
 *   from: { name: "Ada", address: "ada@example.com" },
 *   body: { text: "Thanks — looks good." },
 * });
 * await transport.send(reply.raw, reply.bcc);
 * ```
 *
 * @module
 */

import { createMimeMessage } from "mimetext/browser";
import type { MailboxAddrObject } from "mimetext";

import { deduplicateAddresses, excludeAddresses } from "./addressing.ts";
import { generateMessageId as generateId } from "./internal/message-id.ts";
import { quoteBody as quoteBodyImpl } from "./internal/quote-body.ts";
import { buildReferences as buildRefs } from "./internal/references-builder.ts";
import {
  hasForwardPrefix,
  hasReplyPrefix,
} from "./internal/subject-normalizer.ts";
import { isOrphanId } from "./internal/orphan-id.ts";
import type {
  Attachment,
  ComposedMessage,
  DraftOptions,
  EmailAddress,
  ForwardOptions,
  ParsedEmail,
  ReplyOptions,
} from "./types.ts";

// ─── public re-exports of deep-module helpers ────────────────────────

/**
 * Generate a globally unique RFC 5322 Message-ID of the form
 * `<unix_ms.hex16@domain>`. Uses `globalThis.crypto.getRandomValues`
 * so it runs unchanged in any JavaScript runtime.
 *
 * @param domain The right-hand side of the `@` in the Message-ID —
 * typically your sending domain.
 * @returns A new Message-ID including angle brackets.
 * @throws {Error} When `domain` is empty, non-string, or contains
 * whitespace or `<>@` characters — caller error, not bad email data.
 */
export function generateMessageId(domain: string): string {
  return generateId(domain);
}

/**
 * Build the `References:` header array for a reply or forward.
 *
 * Concatenates `original.references` with `original.messageId` (if
 * present), deduplicates while preserving order, then caps the chain
 * at 20 entries by keeping the first 3 and last 17. The truncation
 * keeps the conversation's root id in place (so threading still
 * anchors) while preserving the most-recent chain (so the immediate
 * reply target is intact), and keeps the serialized header short
 * enough that relays won't truncate or mangle it.
 *
 * @param original The message being replied to or forwarded.
 * @returns A fresh `References` array ready to hand to composition.
 */
export function buildReferences(original: ParsedEmail): string[] {
  return buildRefs(original);
}

/**
 * Format the original message as an HTML blockquote and a `> `-prefixed
 * text quote with attribution. Missing `from` or `date` are handled
 * gracefully — attribution is omitted entirely when both are absent.
 *
 * Note: `original.html` is embedded verbatim; the library does not
 * sanitize. The downstream caller is responsible for HTML sanitization
 * at rendering time. See also {@link createReply} and {@link createForward}.
 *
 * @param original The message to quote.
 * @returns HTML + text representations of the quote block.
 */
export function quoteBody(original: ParsedEmail): {
  html: string;
  text: string;
} {
  return quoteBodyImpl(original);
}

// ─── public composition functions ────────────────────────────────────

/**
 * Build a reply addressed to the original sender only.
 *
 * - `To:` is set from `original.replyTo`, falling back to
 *   `original.from`. An `excludeAddresses` entry matching either one
 *   removes it; the result may legitimately be empty.
 * - `In-Reply-To:` is set to `original.messageId`, unless the id is a
 *   synthesized orphan id (detected via {@link isOrphanId}), in which
 *   case it is omitted — synthesized ids have no real counterpart and
 *   would make no sense as a reply target.
 * - `References:` is built via {@link buildReferences}.
 * - Subject gets a leading `Re: ` unless the subject already carries a
 *   reply prefix in any supported language.
 * - Body is `options.body` followed by a blank line and the output of
 *   {@link quoteBody}.
 *
 * See also {@link createReplyAll}, {@link createForward}.
 *
 * @param original The message being replied to.
 * @param options Reply configuration.
 * @returns The composed reply.
 * @throws {Error} When `options.from` has no domain.
 */
export function createReply(
  original: ParsedEmail,
  options: ReplyOptions,
): ComposedMessage {
  const primary = original.replyTo ?? original.from;
  const to = primary ? [primary] : [];
  const excluded = options.excludeAddresses ?? [];
  const filteredTo = excludeAddresses(to, excluded);

  const subject = ensureReplyPrefix(original.subject ?? "");
  const references = buildRefs(original);
  const messageId = generateId(domainFor(options.from));
  const inReplyTo =
    original.messageId && !isOrphanId(original.messageId)
      ? original.messageId
      : undefined;

  const body = combineBodyWithQuote(options.body, quoteBodyImpl(original));

  return finalizeComposed({
    messageId,
    inReplyTo,
    references,
    subject,
    from: options.from,
    to: filteredTo,
    cc: [],
    bcc: [],
    html: body.html,
    text: body.text,
    attachments: [],
  });
}

/**
 * Build a reply addressed to every non-BCC participant of the original
 * message except anyone listed in `excludeAddresses` (typically your
 * own address, to avoid replying to yourself).
 *
 * Recipients are deduplicated across `To` and `Cc`, case-insensitively.
 * The `Cc` list is also trimmed of any address that already appears in
 * `To`. When every recipient would be excluded, both lists come back
 * empty — the caller decides whether to send.
 *
 * Follows the same `In-Reply-To` omission rule as {@link createReply}:
 * synthesized orphan ids are skipped.
 *
 * @param original The message being replied to.
 * @param options Reply configuration.
 * @returns The composed reply.
 * @throws {Error} When `options.from` has no domain.
 */
export function createReplyAll(
  original: ParsedEmail,
  options: ReplyOptions,
): ComposedMessage {
  const primary = original.replyTo ?? original.from;
  const primaryList: EmailAddress[] = primary ? [primary] : [];
  const combinedTo = deduplicateAddresses([...primaryList, ...original.to]);
  const combinedCc = deduplicateAddresses([...original.cc]);

  const excluded = options.excludeAddresses ?? [];
  const filteredTo = excludeAddresses(combinedTo, excluded);
  const filteredCcBeforeToDedup = excludeAddresses(combinedCc, excluded);

  const toAddresses = new Set(
    filteredTo.map((addr) => addr.address.toLowerCase()),
  );
  const finalCc = filteredCcBeforeToDedup.filter(
    (addr) => !toAddresses.has(addr.address.toLowerCase()),
  );

  const subject = ensureReplyPrefix(original.subject ?? "");
  const references = buildRefs(original);
  const messageId = generateId(domainFor(options.from));
  const inReplyTo =
    original.messageId && !isOrphanId(original.messageId)
      ? original.messageId
      : undefined;

  const body = combineBodyWithQuote(options.body, quoteBodyImpl(original));

  return finalizeComposed({
    messageId,
    inReplyTo,
    references,
    subject,
    from: options.from,
    to: filteredTo,
    cc: finalCc,
    bcc: [],
    html: body.html,
    text: body.text,
    attachments: [],
  });
}

/**
 * Build a forward — a new message with the original content attached
 * inline as a quoted block plus the original's attachments carried
 * into the outgoing MIME body.
 *
 * Style: "quoted forward" (body contains an attribution header and
 * the quoted original). Does not set `In-Reply-To` — a forward is a
 * new conversational thread from the recipient's perspective. Keeps
 * the `References` chain so the forwarded thread remains linkable for
 * archival purposes.
 *
 * @param original The message being forwarded.
 * @param options Forward configuration.
 * @returns The composed forward.
 * @throws {Error} When `options.from` has no domain, or any original
 * attachment is missing its `content` — caller error, since silent
 * attachment loss is worse than failing loudly.
 */
export function createForward(
  original: ParsedEmail,
  options: ForwardOptions,
): ComposedMessage {
  for (const att of original.attachments) {
    if (att.content === undefined) {
      throw new Error(
        "createForward requires Attachment.content on all attachments",
      );
    }
  }

  const subject = ensureForwardPrefix(original.subject ?? "");
  const references = buildRefs(original);
  const messageId = generateId(domainFor(options.from));
  const quoted = quoteBodyImpl(original);
  const attribution = buildForwardAttribution(original);
  const body = combineBodyWithForwardedBlock(
    options.body ?? {},
    attribution,
    quoted,
    original,
  );

  return finalizeComposed({
    messageId,
    references,
    subject,
    from: options.from,
    to: options.to,
    cc: options.cc ?? [],
    bcc: [],
    html: body.html,
    text: body.text,
    attachments: [...original.attachments],
  });
}

/**
 * Build a brand-new outbound message with no threading context.
 * Generates a fresh Message-ID, sets no `In-Reply-To`, and starts
 * `References` empty.
 *
 * @param options Draft configuration.
 * @returns The composed message, including a serialized `raw` form.
 * @throws {Error} When `options.from` has no domain, or any attachment
 * in `options.attachments` is missing its `content`.
 */
export function createDraft(options: DraftOptions): ComposedMessage {
  const attachments = options.attachments ?? [];

  for (const att of attachments) {
    if (att.content === undefined) {
      throw new Error(
        "createDraft requires Attachment.content on all attachments",
      );
    }
  }

  const messageId = generateId(domainFor(options.from));
  const body = options.body ?? {};

  return finalizeComposed({
    messageId,
    references: [],
    subject: options.subject ?? "",
    from: options.from,
    to: options.to ?? [],
    cc: options.cc ?? [],
    bcc: options.bcc ?? [],
    html: body.html,
    text: body.text,
    attachments: [...attachments],
  });
}

// ─── internals ───────────────────────────────────────────────────────

type ComposedDraft = Omit<ComposedMessage, "raw">;

function finalizeComposed(draft: ComposedDraft): ComposedMessage {
  return { ...draft, raw: serializeToRaw(draft) };
}

function domainFor(address: EmailAddress): string {
  const parts = address.address.split("@");

  if (parts.length < 2) {
    throw new Error("options.from must contain a domain (`local@domain`)");
  }

  const last = parts[parts.length - 1];

  if (!last || last.length === 0) {
    throw new Error(
      "options.from must contain a non-empty domain after `@`",
    );
  }

  return last;
}

function ensureReplyPrefix(subject: string): string {
  const trimmed = subject.trim();

  if (hasReplyPrefix(trimmed)) {
    return trimmed;
  }

  return trimmed.length > 0 ? `Re: ${trimmed}` : "Re:";
}

function ensureForwardPrefix(subject: string): string {
  const trimmed = subject.trim();

  if (hasForwardPrefix(trimmed)) {
    return trimmed;
  }

  return trimmed.length > 0 ? `Fwd: ${trimmed}` : "Fwd:";
}

function combineBodyWithQuote(
  userBody: { html?: string | undefined; text?: string | undefined },
  quote: { html: string; text: string },
): { html: string | undefined; text: string | undefined } {
  const html =
    userBody.html !== undefined || quote.html.length > 0
      ? `${userBody.html ?? ""}\n\n${quote.html}`
      : undefined;
  const text =
    userBody.text !== undefined || quote.text.length > 0
      ? `${userBody.text ?? ""}\n\n${quote.text}`
      : undefined;

  return { html, text };
}

function buildForwardAttribution(original: ParsedEmail): string {
  const lines = ["---------- Forwarded message ----------"];

  if (original.from) {
    const from = original.from.name
      ? `${original.from.name} <${original.from.address}>`
      : original.from.address;

    lines.push(`From: ${from}`);
  }

  if (original.date) {
    lines.push(`Date: ${original.date.toISOString()}`);
  }

  if (original.subject) {
    lines.push(`Subject: ${original.subject}`);
  }

  if (original.to.length > 0) {
    lines.push(
      `To: ${original.to
        .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

function combineBodyWithForwardedBlock(
  userBody: { html?: string | undefined; text?: string | undefined },
  attribution: string,
  quote: { html: string; text: string },
  original: ParsedEmail,
): { html: string | undefined; text: string | undefined } {
  const userWantsHtml = userBody.html !== undefined;
  const userWantsText = userBody.text !== undefined;
  const originalHasHtml = original.html !== undefined;
  const originalHasText = original.text !== undefined;

  // Emit the html side only when the caller provided html or the
  // original carried html. Otherwise a text-only forward would pick
  // up a synthetic HTML body it never asked for.
  const html =
    userWantsHtml || originalHasHtml
      ? [
          userBody.html ?? "",
          "",
          `<pre>${escapeForPre(attribution)}</pre>`,
          quote.html,
        ].join("\n")
      : undefined;

  // Same logic for text.
  const text =
    userWantsText || originalHasText
      ? [userBody.text ?? "", "", attribution, "", quote.text].join("\n")
      : undefined;

  return { html, text };
}

function escapeForPre(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── raw serialization via mimetext ──────────────────────────────────

function toMailbox(address: EmailAddress): MailboxAddrObject {
  if (address.name && address.name.length > 0) {
    return { addr: address.address, name: address.name };
  }

  return { addr: address.address };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }

  return btoa(binary);
}

function attachMimetextAttachment(
  msg: ReturnType<typeof createMimeMessage>,
  att: Attachment,
): void {
  if (att.content === undefined) {
    return;
  }

  const headers: Record<string, string> = {};

  if (att.contentId) {
    headers["Content-ID"] = att.contentId;
  }

  msg.addAttachment({
    filename: att.filename ?? "attachment",
    contentType: att.mimeType,
    data: arrayBufferToBase64(att.content),
    inline: att.disposition === "inline",
    headers,
  });
}

function serializeToRaw(draft: ComposedDraft): string {
  const msg = createMimeMessage();

  msg.setSender(toMailbox(draft.from));

  if (draft.to.length > 0) {
    msg.setTo(draft.to.map(toMailbox));
  }

  if (draft.cc.length > 0) {
    msg.setCc(draft.cc.map(toMailbox));
  }

  // Intentional: Bcc is NEVER written into raw. Callers use the
  // structured `bcc` field for envelope-level delivery.

  // mimetext rejects empty-subject messages; pass a single-space when
  // the caller left it blank so the header is still emitted.
  msg.setSubject(draft.subject.length > 0 ? draft.subject : " ");

  msg.setHeader("Message-ID", draft.messageId);

  if (draft.inReplyTo) {
    msg.setHeader("In-Reply-To", draft.inReplyTo);
  }

  if (draft.references.length > 0) {
    msg.setHeader("References", draft.references.join(" "));
  }

  // mimetext requires at least one body part. If neither text nor
  // html was supplied, fall back to an empty text/plain body.
  if (draft.text === undefined && draft.html === undefined) {
    msg.addMessage({ contentType: "text/plain", data: "" });
  } else {
    if (draft.text !== undefined) {
      msg.addMessage({ contentType: "text/plain", data: draft.text });
    }

    if (draft.html !== undefined) {
      msg.addMessage({ contentType: "text/html", data: draft.html });
    }
  }

  for (const att of draft.attachments) {
    attachMimetextAttachment(msg, att);
  }

  const raw = msg.asRaw();

  // Enforce CRLF per SMTP regardless of mimetext's EOL choice.
  return raw.replace(/\r?\n/g, "\r\n");
}
