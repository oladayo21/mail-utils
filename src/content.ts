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

/**
 * Find `cid:` references in the HTML body that are **not** backed by
 * an inline attachment on the same email.
 *
 * Useful before forwarding or rendering: an orphaned `cid:` pointer
 * will render as a broken image in the recipient's client because the
 * referenced part was stripped by a relay, stored externally, or
 * otherwise missing. Callers can rewrite them to data URIs / fallback
 * placeholders, or log a warning.
 *
 * Returns a de-duplicated list of cid tokens (bare, no `cid:` prefix,
 * no angle brackets) in first-seen order. An empty array means every
 * `cid:` reference has a matching inline attachment.
 *
 * @param email The email to inspect.
 * @returns Bare cid tokens referenced from `email.html` without a
 * matching inline attachment.
 *
 * @example
 * ```ts
 * const orphans = findOrphanedCidRefs(email);
 * if (orphans.length > 0) {
 *   console.warn("forwarding with broken inline images:", orphans);
 * }
 * ```
 */
export function findOrphanedCidRefs(email: ParsedEmail): string[] {
  if (!email.html) {
    return [];
  }

  const backed = new Set<string>();

  for (const att of email.attachments) {
    if (!isInlineAttachment(att) || att.contentId === undefined) {
      continue;
    }

    backed.add(stripAngleBrackets(att.contentId));
  }

  const orphans: string[] = [];
  const seen = new Set<string>();
  const pattern = /cid:([^\s"'>)]+)/gi;

  for (const match of email.html.matchAll(pattern)) {
    const ref = match[1];

    if (!ref || seen.has(ref)) {
      continue;
    }

    seen.add(ref);

    if (!backed.has(ref)) {
      orphans.push(ref);
    }
  }

  return orphans;
}

function stripAngleBrackets(id: string): string {
  let s = id.trim();

  if (s.startsWith("<")) s = s.slice(1);
  if (s.endsWith(">")) s = s.slice(0, -1);

  return s;
}
