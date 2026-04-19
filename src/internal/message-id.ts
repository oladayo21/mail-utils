/**
 * Generate RFC 5322 Message-IDs of the form `<unix_ms.hex16@domain>`.
 *
 * Internal module; re-exported publicly as `generateMessageId` from
 * `../composition.ts`.
 *
 * @module
 */

const INVALID_DOMAIN_CHARS = /[\s<>@]/;

/**
 * Format: `<{unix_ms}.{16_hex_chars}@{domain}>`.
 *
 * The 8 random bytes come from `globalThis.crypto.getRandomValues` so
 * the function runs unchanged in Workers, Node, Deno, Bun, and
 * browsers. Throws on invalid `domain` — that's caller error, not bad
 * email data, and the rule #3 "no throws" contract explicitly does
 * not cover it.
 */
export function generateMessageId(domain: string): string {
  if (typeof domain !== "string") {
    throw new Error("generateMessageId: domain must be a string");
  }

  const trimmed = domain.trim();

  if (trimmed.length === 0) {
    throw new Error("generateMessageId: domain must be non-empty");
  }

  if (INVALID_DOMAIN_CHARS.test(trimmed)) {
    throw new Error(
      "generateMessageId: domain cannot contain whitespace or `<>@` characters",
    );
  }

  const bytes = new Uint8Array(8);

  globalThis.crypto.getRandomValues(bytes);

  let hex = "";

  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }

  return `<${Date.now()}.${hex}@${trimmed}>`;
}
