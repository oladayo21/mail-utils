/**
 * Inspectors for the body and attachments of a {@link ParsedEmail}.
 *
 * Pure, sync predicates and extractors — no sanitization, no DOM. The
 * caller owns rendering decisions.
 *
 * @example
 * ```ts
 * import {
 *   extractBody,
 *   listAttachments,
 *   isInlineAttachment,
 * } from "@oflabs/mail-utils";
 *
 * const body = extractBody(email);        // { html?, text? }
 * const files = listAttachments(email);   // user-facing attachments only
 * ```
 *
 * @module
 */

import type { Attachment, ParsedEmail } from "./types.ts";

/**
 * Extract whichever of the HTML and plain-text bodies are present.
 *
 * Returns the fields as-is, without sanitization. HTML should be run
 * through a DOM-aware sanitizer (e.g. DOMPurify) in the rendering
 * layer before being inserted into a document.
 *
 * @param email The parsed email to read from.
 * @returns An object containing whichever of `html` / `text` the email
 * carries. Both keys are omitted when absent.
 *
 * @example
 * ```ts
 * const body = extractBody(email);
 * if (body.html) renderHtml(body.html);
 * else if (body.text) renderPlain(body.text);
 * ```
 */
export function extractBody(
  email: ParsedEmail,
): { html?: string | undefined; text?: string | undefined } {
  const out: { html?: string; text?: string } = {};

  if (email.html !== undefined) {
    out.html = email.html;
  }

  if (email.text !== undefined) {
    out.text = email.text;
  }

  return out;
}

/**
 * Return `true` iff the attachment is an inline part referenced from
 * the HTML body via a `cid:` URL rather than a user-facing attachment.
 *
 * An inline part has `disposition === "inline"` and carries a
 * non-empty `contentId`. Inline parts missing or with an empty
 * `contentId` (malformed clients) are treated as regular attachments
 * since they cannot be `cid:`-referenced from the HTML body.
 *
 * @example
 * ```ts
 * isInlineAttachment({ disposition: "inline", contentId: "<logo@x>", ... }) // true
 * isInlineAttachment({ disposition: "inline", ... })                         // false
 * isInlineAttachment({ disposition: "attachment", ... })                     // false
 * ```
 */
export function isInlineAttachment(attachment: Attachment): boolean {
  return (
    attachment.disposition === "inline" &&
    attachment.contentId !== undefined &&
    attachment.contentId.length > 0
  );
}

/**
 * Return the user-facing attachments — attachments and inline parts
 * that are **not** referenced from the HTML body via `cid:`.
 *
 * Equivalent to filtering out every entry for which
 * {@link isInlineAttachment} returns `true`.
 *
 * @example
 * ```ts
 * const files = listAttachments(email);
 * for (const f of files) console.log(f.filename, f.size);
 * ```
 */
export function listAttachments(email: ParsedEmail): Attachment[] {
  return email.attachments.filter((a) => !isInlineAttachment(a));
}
