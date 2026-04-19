/**
 * Strip reply/forward prefixes and org-injected bracket/asterisk
 * markers from a subject line for threading-fallback comparison.
 *
 * Internal module; re-exported publicly as `normalizeSubject` from
 * `../threading.ts`.
 *
 * @module
 */

// Reply prefixes across EN, DE, FR, ES, IT, PT, NL, PL plus the
// general `Re[n]:` variant some mailers use for thread depth.
// Single-letter alternatives (`R:`, `I:`) are intentionally NOT in
// the list — they would mangle legitimate subjects like "r: rocket
// launch", and the languages that use them also accept the longer
// forms in practice.
const REPLY_PREFIX =
  /^(re\s*\[\d+\]|re|aw|r[ée]p|r[ée]|rv|ref|antw|odp|sv)\s*:\s*/i;

// Forward prefixes across the same languages.
const FORWARD_PREFIX =
  /^(fwd?|wg|tr|rif|enc|doorst|pd|vs)\s*:\s*/i;

// [EXT], [EXTERNAL], [SPAM], [SUSPICIOUS], etc.
const BRACKET_PREFIX = /^\[[^\]]+\]\s*/;

// ***SPAM***, **URGENT**, etc. Balanced asterisk markers at the start.
const ASTERISK_PREFIX = /^\*{2,}[^*]+\*{2,}\s*/;

const STRIPPERS: ReadonlyArray<RegExp> = [
  REPLY_PREFIX,
  FORWARD_PREFIX,
  BRACKET_PREFIX,
  ASTERISK_PREFIX,
];

const MAX_ITERATIONS = 10;

/**
 * Iteratively strip every known prefix/marker from the start of
 * `subject` until nothing matches or the safety cap is hit.
 *
 * @param subject Raw subject. Non-string input returns `""`.
 * @returns Trimmed subject with every leading prefix removed.
 */
export function normalizeSubject(subject: string): string {
  if (typeof subject !== "string") {
    return "";
  }

  let current = subject.trim();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let stripped = false;

    for (const re of STRIPPERS) {
      if (re.test(current)) {
        current = current.replace(re, "").trim();
        stripped = true;
      }
    }

    if (!stripped) {
      break;
    }
  }

  return current;
}
