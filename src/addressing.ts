/**
 * Parsing, formatting, validating, and filtering of email addresses.
 *
 * All functions in this module are synchronous and never throw — malformed
 * or non-string input yields sensible defaults (`undefined`, `[]`, `false`).
 *
 * @example
 * ```ts
 * import { parseAddressList, formatAddress } from "@oflabs/mail-utils";
 *
 * const addrs = parseAddressList('"Alice" <alice@example.com>, bob@example.com');
 * addrs.map(formatAddress).join(", ");
 * ```
 *
 * @module
 */

import emailAddresses from "email-addresses";
import { decodeWords } from "postal-mime";

import type { EmailAddress } from "./types.ts";

// RFC 5322 display-name specials + control/DEL chars that force a quoted-string.
const NEEDS_QUOTING = /[()<>[\]:;@\\,"]|[\x00-\x1f\x7f]/;

type Parsed = emailAddresses.ParsedMailbox | emailAddresses.ParsedGroup;

function toEmailAddress(mailbox: {
  name: string | null;
  address: string;
}): EmailAddress {
  const decodedName = mailbox.name ? decodeWords(mailbox.name).trim() : "";

  if (decodedName.length === 0) {
    return { address: mailbox.address };
  }

  return { name: decodedName, address: mailbox.address };
}

function flatten(parsed: ReadonlyArray<Parsed>): EmailAddress[] {
  const out: EmailAddress[] = [];

  for (const entry of parsed) {
    if (entry.type === "group") {
      for (const mailbox of entry.addresses) {
        out.push(toEmailAddress(mailbox));
      }

      continue;
    }

    out.push(toEmailAddress(entry));
  }

  return out;
}

function safeParseList(raw: string): ReadonlyArray<Parsed> | null {
  try {
    return emailAddresses.parseAddressList(raw);
  } catch {
    // Contract: malformed input yields defaults rather than throwing.
    return null;
  }
}

/**
 * Parse a header value that is expected to contain one mailbox
 * (e.g. `From:`, `Sender:`, `Reply-To:` single-mailbox form).
 *
 * If the input parses to multiple mailboxes (or a group with multiple
 * members), the first mailbox is returned and the rest are silently
 * dropped. For multi-mailbox contexts use {@link parseAddressList}.
 *
 * @param raw The header value to parse. Encoded-words (`=?UTF-8?B?...?=`)
 * in the display name are decoded per RFC 2047.
 * @returns The first parsed mailbox, or `undefined` if parsing fails or
 * the input contains no mailboxes.
 *
 * @example
 * ```ts
 * parseAddress('"Ada Lovelace" <ada@example.com>')
 * // { name: "Ada Lovelace", address: "ada@example.com" }
 * ```
 */
export function parseAddress(raw: string): EmailAddress | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }

  const parsed = safeParseList(raw);

  if (!parsed || parsed.length === 0) {
    return undefined;
  }

  return flatten(parsed)[0];
}

/**
 * Parse a header value that may contain multiple mailboxes separated
 * by commas (e.g. `To:`, `Cc:`, `Bcc:`). Group syntax is flattened into
 * its member mailboxes.
 *
 * @param raw The header value to parse. Encoded-words in display names
 * are decoded per RFC 2047.
 * @returns The parsed mailboxes in original order, or `[]` if parsing
 * fails.
 *
 * @example
 * ```ts
 * parseAddressList('Ada <ada@example.com>, Grace <grace@example.com>')
 * // [
 * //   { name: "Ada",   address: "ada@example.com" },
 * //   { name: "Grace", address: "grace@example.com" },
 * // ]
 * ```
 */
export function parseAddressList(raw: string): EmailAddress[] {
  if (typeof raw !== "string" || !raw) {
    return [];
  }

  const parsed = safeParseList(raw);

  if (!parsed) {
    return [];
  }

  return flatten(parsed);
}

/**
 * Serialize an {@link EmailAddress} back to an RFC 5322 header value.
 *
 * Display names containing any of the RFC 5322 specials (`()<>[]:;@\,"`)
 * or control characters are wrapped in a quoted-string; internal quotes
 * and backslashes are escaped. A missing or empty `name` yields the
 * bare address. An empty `address` yields `""` — callers that care
 * about syntactic validity should guard with {@link isValidSingleAddress}.
 *
 * @param address The mailbox to serialize.
 * @returns The RFC 5322 `name <addr>` form, or the bare `addr` if no
 * usable name is present.
 *
 * @example
 * ```ts
 * formatAddress({ name: "Ada Lovelace", address: "ada@example.com" })
 * // 'Ada Lovelace <ada@example.com>'
 *
 * formatAddress({ name: 'Lovelace, Ada', address: "ada@example.com" })
 * // '"Lovelace, Ada" <ada@example.com>'
 * ```
 */
export function formatAddress(address: EmailAddress): string {
  if (!address.name || address.name.length === 0) {
    return address.address;
  }

  const name = address.name;

  if (NEEDS_QUOTING.test(name)) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return `"${escaped}" <${address.address}>`;
  }

  return `${name} <${address.address}>`;
}

/**
 * Returns `true` iff `raw` parses as exactly one valid mailbox.
 *
 * Syntax only — no DNS validation. Use for form fields where a single
 * address is expected (e.g. "From" picker, account email input).
 *
 * @param raw The input to validate.
 * @returns `true` when the input parses as exactly one mailbox; `false`
 * on garbage, empty input, multiple addresses, or group syntax.
 *
 * @example
 * ```ts
 * isValidSingleAddress("ada@example.com")                      // true
 * isValidSingleAddress("ada@example.com, grace@example.com")   // false (multi)
 * isValidSingleAddress("not an address")                       // false
 * ```
 */
export function isValidSingleAddress(raw: string): boolean {
  if (typeof raw !== "string" || !raw) {
    return false;
  }

  const parsed = safeParseList(raw);

  if (!parsed || parsed.length !== 1) {
    return false;
  }

  return parsed[0]?.type === "mailbox";
}

/**
 * Returns `true` iff `raw` parses as one or more valid mailboxes
 * (To/Cc/Bcc form).
 *
 * Group syntax is accepted and counts toward the mailbox total after
 * flattening. An empty group (e.g. `undisclosed-recipients:;`) returns
 * `false` because it contributes zero mailboxes.
 *
 * @param raw The input to validate.
 * @returns `true` when flattening yields at least one mailbox.
 *
 * @example
 * ```ts
 * isValidAddressList("ada@example.com")                            // true
 * isValidAddressList("Team: ada@example.com, grace@example.com;")  // true
 * isValidAddressList("undisclosed-recipients:;")                   // false (empty group)
 * ```
 */
export function isValidAddressList(raw: string): boolean {
  if (typeof raw !== "string" || !raw) {
    return false;
  }

  const parsed = safeParseList(raw);

  if (!parsed) {
    return false;
  }

  return flatten(parsed).length > 0;
}

/**
 * Deduplicate a list of {@link EmailAddress} entries by `address`,
 * case-insensitively.
 *
 * Preserves the first occurrence of each address and retains the `name`
 * from that first occurrence. Original order is preserved. Input is
 * never mutated.
 *
 * @param addresses The addresses to deduplicate.
 * @returns A new array with duplicates removed.
 *
 * @example
 * ```ts
 * deduplicateAddresses([
 *   { name: "Ada", address: "ada@example.com" },
 *   { address: "ADA@example.com" },
 * ])
 * // [{ name: "Ada", address: "ada@example.com" }]
 * ```
 */
export function deduplicateAddresses(
  addresses: ReadonlyArray<EmailAddress>,
): EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];

  for (const entry of addresses) {
    const key = entry.address.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(entry);
  }

  return out;
}

/**
 * Remove any {@link EmailAddress} whose `address` matches an entry in
 * `exclude`, case-insensitively.
 *
 * Used in reply-all composition to strip the user's own address(es)
 * from recipient lists.
 *
 * @param addresses The list to filter.
 * @param exclude Addresses to remove; compared case-insensitively.
 * @returns A new array containing only the addresses that are not in
 * `exclude`. Original order is preserved; input is never mutated.
 *
 * @example
 * ```ts
 * excludeAddresses(
 *   [{ address: "ada@example.com" }, { address: "grace@example.com" }],
 *   ["ADA@example.com"],
 * )
 * // [{ address: "grace@example.com" }]
 * ```
 */
export function excludeAddresses(
  addresses: ReadonlyArray<EmailAddress>,
  exclude: ReadonlyArray<string>,
): EmailAddress[] {
  if (exclude.length === 0) {
    return addresses.slice();
  }

  const excludeSet = new Set(exclude.map((a) => a.toLowerCase()));

  return addresses.filter((entry) => !excludeSet.has(entry.address.toLowerCase()));
}
