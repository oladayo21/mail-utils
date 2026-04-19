/**
 * Generate RFC 5322 Message-IDs of the form `<unix_ms.hex16@domain>`.
 *
 * Internal module; re-exported publicly as `generateMessageId` from
 * `../composition.ts`.
 *
 * @module
 */

const INVALID_DOMAIN_CHARS = /[\s<>@]/;

function toAsciiDomain(input: string): string {
  // Run the candidate through the WHATWG URL parser, which handles
  // IDN (punycode) conversion and lowercasing. Fall back to the raw
  // input when parsing fails — the caller's separate validation
  // below will then reject it.
  try {
    return new URL(`http://${input}`).hostname;
  } catch {
    return input;
  }
}

/**
 * Format: `<{unix_ms}.{16_hex_chars}@{domain}>`.
 *
 * The 8 random bytes come from `globalThis.crypto.getRandomValues` so
 * the function runs unchanged in Workers, Node, Deno, Bun, and
 * browsers. Internationalized (IDN) domains are normalized via the
 * WHATWG URL API — `"münchen.de"` becomes `"xn--mnchen-3ya.de"`.
 *
 * Throws on invalid `domain` (caller error, not bad email data).
 */
export function generateMessageId(domain: string): string {
  if (typeof domain !== "string") {
    throw new Error("generateMessageId: domain must be a string");
  }

  const trimmed = domain.trim();

  if (trimmed.length === 0) {
    throw new Error("generateMessageId: domain must be non-empty");
  }

  // Validate the raw input before normalization — the URL parser is
  // permissive enough to treat `exam@ple.com` as `userinfo@host`.
  if (INVALID_DOMAIN_CHARS.test(trimmed)) {
    throw new Error(
      "generateMessageId: domain cannot contain whitespace or `<>@` characters",
    );
  }

  const normalized = toAsciiDomain(trimmed);

  if (normalized.length === 0 || INVALID_DOMAIN_CHARS.test(normalized)) {
    throw new Error("generateMessageId: domain failed normalization");
  }

  const bytes = new Uint8Array(8);

  globalThis.crypto.getRandomValues(bytes);

  let hex = "";

  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }

  return `<${Date.now()}.${hex}@${normalized}>`;
}
