/**
 * Deterministic thread-id synthesis for emails with no Message-ID,
 * In-Reply-To, or References.
 *
 * Uses a 64-bit FNV-1a variant instead of SHA-256 because
 * `crypto.subtle.digest` is asynchronous and the library's design rule
 * keeps every function except `parseMessage` synchronous. For thread
 * grouping we need determinism and a low collision rate, not
 * cryptographic strength.
 *
 * @module
 */

import type { ParsedEmail } from "../types.ts";

const FNV_OFFSET_HIGH = 0xcbf2_9ce4;
const FNV_OFFSET_LOW = 0x8422_2325;
const FNV_PRIME_HIGH = 0x0000_0100;
const FNV_PRIME_LOW = 0x0000_01b3;
const MASK_32 = 0xffff_ffff;

// Split 64-bit FNV-1a implemented as two 32-bit halves to stay within
// safe-integer arithmetic. Returns the 64-bit hash as a 16-char hex
// string (big-endian).
function fnv1a64(input: string): string {
  let hi = FNV_OFFSET_HIGH;
  let lo = FNV_OFFSET_LOW;
  const bytes = new TextEncoder().encode(input);

  for (const b of bytes) {
    lo ^= b;

    // Multiply the 64-bit value [hi:lo] by the 64-bit prime
    // [FNV_PRIME_HIGH:FNV_PRIME_LOW] using 32-bit half-products.
    const loLo = (lo & 0xffff) * FNV_PRIME_LOW;
    const loHi = (lo >>> 16) * FNV_PRIME_LOW;
    const hiLo = (lo & 0xffff) * FNV_PRIME_HIGH;
    const hiHi = hi * FNV_PRIME_LOW;

    const carry = (loHi >>> 16) + (hiLo >>> 16);
    const newLo = ((loLo + ((loHi & 0xffff) << 16)) & MASK_32) >>> 0;
    const newHi =
      (hiHi + (hiLo & ~0xffff) + ((loHi & ~0xffff) >>> 0) + carry * 0x10000) &
      MASK_32;

    // The cross-term hiHi*PRIME_HIGH would overflow for 32-bit high
    // halves but contributes nothing distinguishing at the top, so we
    // follow common 64-bit FNV-1a implementations and drop it.
    hi = newHi >>> 0;
    lo = newLo;
  }

  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

function firstChars(value: string | undefined, n: number): string {
  if (!value) {
    return "";
  }

  return value.slice(0, n);
}

/**
 * Derive a deterministic synthesized Message-ID for an email that has
 * no real threading headers. Same input → same output; different
 * inputs differ with overwhelming probability.
 *
 * @param email The orphan email.
 * @returns A Message-ID of the form `<orphan.{16-hex}@local>`. The
 * `@local` sentinel lets reply composition recognize a synthesized id
 * and skip `In-Reply-To` on the reply.
 */
export function synthesizeOrphanId(email: ParsedEmail): string {
  const fromField = email.from
    ? `${email.from.name ?? ""}<${email.from.address}>`
    : "";
  const subject = email.subject ?? "";
  const date = email.date ? email.date.toISOString() : "";
  const body = firstChars(email.html ?? email.text, 100);

  const payload = `${fromField}\u0000${subject}\u0000${date}\u0000${body}`;

  return `<orphan.${fnv1a64(payload)}@local>`;
}

/**
 * Sentinel domain used to mark synthesized ids so that downstream
 * reply composition can detect "don't set In-Reply-To for this one."
 */
export const ORPHAN_DOMAIN = "@local>";

/** Returns `true` if `id` looks like a synthesized orphan id. */
export function isOrphanId(id: string): boolean {
  return id.startsWith("<orphan.") && id.endsWith(ORPHAN_DOMAIN);
}
