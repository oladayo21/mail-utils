/**
 * Platform-agnostic TypeScript utilities for email. Shipped modules so
 * far: address parsing, formatting, validation, and list utilities.
 * Parsing, threading, and composition modules are planned — track
 * progress at https://github.com/oladayo21/mail-utils/issues.
 *
 * @example
 * ```ts
 * import { parseAddressList, formatAddress } from "@oflabs/mail-utils";
 *
 * const addrs = parseAddressList(
 *   "Ada <ada@example.com>, Grace <grace@example.com>",
 * );
 * addrs.map(formatAddress);
 * ```
 *
 * @module
 */

export type {
  Attachment,
  EmailAddress,
  ParsedEmail,
  ThreadingHeaders,
} from "./types.ts";

export {
  deduplicateAddresses,
  excludeAddresses,
  formatAddress,
  isValidAddressList,
  isValidSingleAddress,
  parseAddress,
  parseAddressList,
} from "./addressing.ts";

export { extractThreadingHeaders, parseMessage } from "./parsing.ts";

export {
  extractBody,
  isInlineAttachment,
  listAttachments,
} from "./content.ts";
