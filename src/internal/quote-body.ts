/**
 * Build HTML + text quote blocks for inclusion in a reply or forward.
 *
 * Internal module; re-exported publicly as `quoteBody` from
 * `../composition.ts`.
 *
 * @module
 */

import type { ParsedEmail } from "../types.ts";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToSimpleHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function formatAttribution(
  original: ParsedEmail,
): string | undefined {
  const who = original.from
    ? original.from.name && original.from.name.length > 0
      ? original.from.name
      : original.from.address
    : undefined;
  const when = original.date ? original.date.toISOString() : undefined;

  if (who && when) return `On ${when}, ${who} wrote:`;
  if (who) return `${who} wrote:`;
  if (when) return `On ${when}, someone wrote:`;

  return undefined;
}

/**
 * Format `original` as an HTML `<blockquote>` + a `> `-prefixed text
 * quote, each preceded by an attribution line unless both `from` and
 * `date` are missing.
 *
 * HTML quote uses `original.html` when present; otherwise falls back
 * to `original.text` escaped and line-broken into simple HTML. Text
 * quote always uses `original.text` (or `""` when absent).
 */
export function quoteBody(original: ParsedEmail): {
  html: string;
  text: string;
} {
  const attribution = formatAttribution(original);

  const htmlSource = original.html
    ? original.html
    : original.text
      ? textToSimpleHtml(original.text)
      : "";
  const htmlAttribution = attribution
    ? `<p>${escapeHtml(attribution)}</p>\n`
    : "";
  const html = `${htmlAttribution}<blockquote>${htmlSource}</blockquote>`;

  const textSource = original.text ?? "";
  const quoted =
    textSource.length > 0
      ? textSource
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join("\n")
      : "> ";
  const text = attribution ? `${attribution}\n${quoted}` : quoted;

  return { html, text };
}
