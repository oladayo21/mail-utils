/**
 * Platform-agnostic TypeScript utilities for email. Runs anywhere
 * modern JS runs — Workers, Node, Deno, Bun, browsers — with no
 * platform bindings and no I/O. Covers address parsing and
 * formatting, MIME parsing, body and attachment extraction,
 * JWZ-style threading, and reply/forward/draft composition.
 *
 * @example
 * ```ts
 * import { parseAddressList, formatAddress } from "@oflabs/email-utils";
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
  ComposedMessage,
  DraftOptions,
  EmailAddress,
  ForwardOptions,
  ParsedEmail,
  ReplyOptions,
  Thread,
  ThreadingHeaders,
  ThreadNode,
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

export {
  DEFAULT_MAX_ATTACHMENT_SIZE,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_MAX_HEADER_SIZE,
  extractThreadingHeaders,
  parseMessage,
} from "./parsing.ts";
export type { ParseMessageOptions } from "./parsing.ts";

export {
  extractBody,
  findOrphanedCidRefs,
  isInlineAttachment,
  listAttachments,
} from "./content.ts";

export {
  buildThreads,
  getThreadId,
  ingestIntoThreads,
  isOrphanId,
  normalizeSubject,
} from "./threading.ts";

export {
  buildReferences,
  createDraft,
  createForward,
  createReply,
  createReplyAll,
  generateMessageId,
  quoteBody,
} from "./composition.ts";
