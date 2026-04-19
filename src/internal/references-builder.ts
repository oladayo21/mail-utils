/**
 * Build the `References:` header value for a reply or forward, with
 * the 20-entry truncation rule (first 3 + last 17) that keeps long
 * threads below every known SMTP-relay header-size cutoff.
 *
 * Internal module; re-exported publicly as `buildReferences` from
 * `../composition.ts`.
 *
 * @module
 */

import type { ParsedEmail } from "../types.ts";

const MAX_REFERENCES = 20;
const KEEP_HEAD = 3;
const KEEP_TAIL = MAX_REFERENCES - KEEP_HEAD;

/**
 * Concatenate `original.references` with `original.messageId` (if any),
 * dedupe preserving order, then cap the result at 20 entries by
 * keeping the first 3 and last 17. Caller receives a fresh array.
 */
export function buildReferences(original: ParsedEmail): string[] {
  const combined: string[] = [...original.references];

  if (original.messageId) {
    combined.push(original.messageId);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const ref of combined) {
    if (seen.has(ref)) {
      continue;
    }

    seen.add(ref);
    deduped.push(ref);
  }

  if (deduped.length <= MAX_REFERENCES) {
    return deduped;
  }

  return [
    ...deduped.slice(0, KEEP_HEAD),
    ...deduped.slice(deduped.length - KEEP_TAIL),
  ];
}
