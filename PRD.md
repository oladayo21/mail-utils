# PRD: `mail-utils` — Platform-agnostic Email Utility Library

**PRD slug:** `prd/mail-utils-v1`

---

## Problem Statement

Email parsing, threading, and composition logic keeps getting re-written across every project that touches mail. Each rewrite makes different tradeoffs: Node-only utilities fail in Workers; Workers utilities fail in the browser; everything inlines a half-broken JWZ threading implementation; every project reinvents `Re:`/`Fwd:` handling with subtle bugs; Bcc leaks into outbound raw bytes; Message-ID generation is a grab-bag of `Date.now()` + `Math.random()`. The result: threading breaks, bounces go unmatched, and every team pays the same tax.

There is no TypeScript library today that is (a) genuinely platform-agnostic, (b) gives you a structured `ParsedEmail` from raw MIME, (c) threads a flat message list into a proper JWZ tree, and (d) composes replies/forwards/drafts whose `raw` bytes are safe to hand to any SMTP-capable transport.

## Solution

A single TypeScript utility package — `mail-utils` — with named-export, pure-function APIs for parsing, threading, composition, addressing, and content inspection. Zero I/O, zero platform bindings, zero Node built-ins. Runs unchanged in Cloudflare Workers, Node, Deno, Bun, browsers, and test runners. Every function is synchronous except `parseMessage`. Every behavior is documented, tested against a corpus of real-world gnarly emails, and free of silent data loss (no dropped headers, no lost attachments, no BCC leaks, no thread truncation).

## User Stories

### Parsing

1. As a library consumer, I want to parse raw MIME (string or ArrayBuffer) into a structured `ParsedEmail`, so I can work with strongly-typed email data without hand-rolling a MIME parser.
2. As a library consumer, I want the parser to never throw on malformed emails and instead return sensible defaults, so my pipeline stays resilient to real-world input.
3. As a library consumer, I want raw headers preserved including duplicates (Received, DKIM-Signature, Authentication-Results) as `Map<string, string[]>` with lowercase keys, so I can audit delivery paths and verify signatures without losing data.
4. As a library consumer, I want a fast way to extract only the three threading-relevant headers (messageId, inReplyTo, references) from a `ParsedEmail`, so I can make threading decisions cheaply without dragging the full object around.

### Threading

5. As a library consumer, I want to build a full JWZ thread tree from a flat array of parsed emails, so I can display conversation structure to end users.
6. As a library consumer, I want virtual-root containers preserved in the thread tree when a parent message is missing but multiple children reference it, so orphan replies remain correctly grouped as one conversation.
7. As a library consumer, I want a stable thread ID derived from a single email without running full JWZ, so I can assign `thread_id` during live ingestion before storage.
8. As a library consumer, I want orphan emails (no messageId, inReplyTo, or references) to get a deterministic synthesized thread ID, so re-ingesting the same orphan doesn't create duplicate lonely threads.
9. As a library consumer, I want to ingest a single newly-arrived email into an existing array of threads and receive back the updated immutable array plus the affected thread id, so my live pipeline doesn't rebuild every thread on every new message.
10. As a library consumer, I want multilingual subject normalization covering EN/DE/FR/ES/IT/PT/NL/PL reply+forward prefixes plus bracket (`[EXT]`) and asterisk (`***SPAM***`) markers, so subject-fallback threading works for international mail.
11. As a library consumer, I want deterministic deduplication of messages by Message-ID (preferring the copy with the richest content), so thread building is independent of input order.
12. As a library consumer, I want thread siblings sorted with a deterministic comparator that handles undefined dates (dated-before-undated, ascending, stable), so my rendered ordering is reproducible across calls.

### Composition

13. As a library consumer, I want to generate RFC 5322 Message-IDs in the format `<unix_ms.hex16@domain>` via web crypto, so outgoing messages are trackable, globally unique, and runtime-portable.
14. As a library consumer, I want `buildReferences` to cap the References chain at 20 entries using "first 3 + last 17", so long threads don't break on relays that truncate oversized headers.
15. As a library consumer, I want a pure `quoteBody` that produces HTML + text quote blocks with attribution gracefully handling missing from/date, so reply composition yields consistent output even on malformed originals.
16. As a library consumer, I want `createReply` to reply to the sender (or `replyTo`) only, with correct In-Reply-To, References, and multilingual-aware `Re:` subject handling, so I can build reply features on any platform.
17. As a library consumer, I want `createReplyAll` to reply to everyone except me (via `excludeAddresses`), deduplicated across To and Cc, even when that leaves recipients empty, so reply-all behaves predictably without silent fallbacks.
18. As a library consumer, I want `createForward` to produce a quoted forward (not an `.eml` attachment) with attribution, `Fwd:` subject, carried attachments, and maintained References chain, so recipients see standard forwarded content in every mail client.
19. As a library consumer, I want `createForward` to throw when any original attachment lacks `content`, so silent attachment loss is impossible.
20. As a library consumer, I want `createDraft` to build a standalone outbound message with a fresh messageId and no threading context, so I can compose brand-new messages with the same type surface as replies/forwards.
21. As a library consumer, I want `ComposedMessage.raw` to exclude the `Bcc:` header and expose BCC recipients only via the structured field, so I can drive envelope-level BCC delivery without leaking recipient lists to all recipients.

### Addressing

22. As a library consumer, I want `parseAddressList` and `parseAddress` as separate functions (list returns array, single returns one-or-undefined), so address-field handling isn't ambiguous at the call site.
23. As a library consumer, I want `formatAddress` that quotes display names containing special characters, so serialized addresses are always wire-safe per RFC 5322.
24. As a library consumer, I want `isValidSingleAddress` and `isValidAddressList` as separate validators, so form validation can enforce the right contract.
25. As a library consumer, I want `deduplicateAddresses` (case-insensitive on address, stable order, retains first-seen name) and `excludeAddresses` (case-insensitive filter), so reply-all recipient lists are clean and deterministic.

### Content

26. As a library consumer, I want `extractBody` to return whichever of html/text are present, unsanitized, so I can render content in my own layer with my own DOM/sanitization strategy.
27. As a library consumer, I want `listAttachments` to return only true attachments (filtering inline `cid:`-referenced images), so my "Attachments" UI doesn't show inline logos.
28. As a library consumer, I want `isInlineAttachment` as a standalone predicate, so I can classify attachments in my own flows.
29. As a library consumer, I want `Attachment.content` optional (present post-parse, strippable post-storage), so I can decouple attachment metadata from payload lifecycle in my own storage layer.

### Cross-cutting

30. As a library consumer, I want all functions except `parseMessage` to be synchronous, so I can use them in any code path without propagating Promises.
31. As a library consumer, I want named exports only (no default class, no global state), so every function is tree-shakable and individually importable.
32. As a library consumer, I want zero Node.js built-in imports — `globalThis.crypto` only, no `Buffer`/`fs`/`path` — so the library runs unchanged in any JavaScript runtime.
33. As a library maintainer, I want a fixture corpus of real-world gnarly emails (mailing-list digests, encoded display names, malformed headers, TNEF-wrapped, multi-hop Received chains, duplicate Message-IDs, oversized References), so tests catch regressions on actual-world input rather than contrived synthetic cases.
34. As a library maintainer, I want every public exported function and type to have explicit return types and no inferred API shape, so the package passes JSR's "no slow types" policy and publishes with full auto-generated docs.
35. As a library maintainer, I want a JSR publish pipeline driven by git tags (`v*`) using GitHub Actions OIDC auth (no long-lived token), so releases are traceable and credentials never live outside the CI runner.
36. As a library consumer browsing jsr.io, I want every module and every public export documented with TSDoc (module-level `@module` summary, per-symbol `@param` / `@returns` / `@throws` / `@example`, cross-links via `{@link}`), so the auto-generated JSR docs page is useful without me having to read the source.

## Implementation Decisions

### Modules

- **`types`** — Shared type surface: `EmailAddress`, `Attachment` (with `content?: ArrayBuffer`), `ParsedEmail` (with `headers: Map<string, string[]>`), `ThreadNode` (with optional `email` and required `messageId`), `Thread`, `ComposedMessage`, `ReplyOptions`, `ForwardOptions`, `DraftOptions`, `ThreadingHeaders`.
- **`parsing`** — `parseMessage` (async, wraps `postal-mime`), `extractThreadingHeaders` (sync). The only async surface in the library.
- **`threading`** — `buildThreads` (JWZ batch), `ingestIntoThreads` (JWZ live, immutable), `getThreadId` (single-email heuristic with orphan synthesis), `normalizeSubject` (multilingual).
- **`composition`** — `generateMessageId`, `buildReferences` (with 20-entry truncation), `quoteBody`, `createReply`, `createReplyAll`, `createForward`, `createDraft`. Wraps `mimetext` to produce `raw`.
- **`addressing`** — `parseAddress`, `parseAddressList`, `formatAddress`, `isValidSingleAddress`, `isValidAddressList`, `deduplicateAddresses`, `excludeAddresses`.
- **`content`** — `extractBody`, `listAttachments`, `isInlineAttachment`.
- **`index`** — Named re-exports of every public function + type.

### Deep modules to extract for isolated testing

- **`jwz-tree-builder`** (inside `threading`): takes a set of `{messageId, inReplyTo, references, subject, date}` records, returns a tree of `ThreadNode`s with container handling per JWZ. No knowledge of `ParsedEmail` as a whole — only threading-relevant fields. Trivially unit-testable with synthetic inputs.
- **`subject-normalizer`** (inside `threading`): multilingual prefix stripping. Pure string-in, string-out. Loop-capped at 10 iterations.
- **`references-builder`** (inside `composition`): concat + dedupe + 20-entry first-3-last-17 truncation. Pure.
- **`quote-body`** (inside `composition`): takes a `ParsedEmail`, returns `{html, text}`. Pure; handles missing fields; no mimetext involvement.
- **`message-id-generator`** (inside `composition`): takes domain, returns `<unix_ms.hex16@domain>`. Uses `globalThis.crypto.getRandomValues`. Throws on invalid domain.
- **`orphan-id-synthesizer`** (inside `threading`): takes a `ParsedEmail`, returns a deterministic `<orphan.sha256-prefix@local>` id. Pure, hashable.

### Decisions locked in during /grll-me interview

1. `ComposedMessage.raw` omits the `Bcc:` header. Callers read `bcc` field separately and drive envelope-level delivery.
2. Message-ID format: `<unix_ms.hex16@domain>`. Random bytes via `getRandomValues(new Uint8Array(8))` hex-encoded. Throw on invalid/empty domain (caller error).
3. `getThreadId` synthesizes a deterministic orphan id `<orphan.sha256(from+subject+date+first100CharsBody).slice(0,16)@local>` when all three threading fields are absent. Reply composition detects the `@local` sentinel and skips `In-Reply-To`.
4. `ThreadNode.email` is optional; `ThreadNode.messageId` is always present. `messageCount` counts only nodes where `email` is present.
5. `buildReferences` caps at 20 entries via "first 3 + last 17". Deterministic.
6. `Attachment.content` is optional. `createForward` throws `Error("createForward requires Attachment.content on all attachments")` if any attachment's content is missing. All other functions tolerate missing content.
7. Date handling:
   - Sort comparator: dated-before-undated, ascending, stable.
   - Subject fallback: skip entirely if candidate has no date.
   - `ingestIntoThreads`: insert as child of parent (via threading headers), then sort siblings with the comparator.
   - `quoteBody` attribution: ISO 8601 UTC for dates; template variants per combination of missing from/date; omit attribution entirely when both missing.
8. `headers: Map<string, string[]>` with lowercase keys; preserves order of duplicate headers.
9. `normalizeSubject` covers EN, DE, FR, ES, IT, PT, NL, PL reply + forward prefixes, plus bracket and asterisk markers. Loop-strip with 10-iteration cap.
10. `buildThreads` dedup by Message-ID with deterministic scoring (`html` +3, `text` +2, attachments +1, more headers tiebreak, first-occurrence stable tiebreak) — not last-write-wins.
11. Address parsing split: `parseAddressList` (plural), `parseAddress` (single or undefined). Validation split: `isValidSingleAddress`, `isValidAddressList`.
12. `createForward` uses the quoted-forward style (Style A), not `.eml`-attachment style. Body = `options.body` + attribution + `quoteBody(original)`. Attachments copied from original.
13. Verification tasks for implementation time: confirm `mimetext` emits CRLF (post-process `raw` if not). Note: `postal-mime` **does** publicly export `decodeWords` (verified 2026-04-19, v2.7.4) — use it directly for RFC 2047 display-name decoding; do not inline a parallel decoder.

### Stack

- `postal-mime` — MIME parsing (only used inside `parseMessage`).
- `mimetext` — MIME composition (only used inside composition functions).
- `email-addresses` — RFC 5322 address parsing.
- `vitest` — test runner.
- TypeScript strict mode; `tsconfig` target ES2022; `noEmit: true` (no build step — JSR consumes TS source).
- Package manager: pnpm.
- `DOMPurify` is explicitly NOT a dependency.

### Publishing

- Registry: **JSR only** at `@oflabs/mail-utils`. No npm. No built `dist/`.
- `jsr.json` is the publish manifest; `exports` points at `./src/index.ts`.
- Authenticated release via GitHub Actions OIDC (`id-token: write`) triggered on `v*` tag push.
- Local dry-run: `make publish-jsr-dry`. Local real publish (if ever needed): `make publish-jsr`, which interactively authenticates.
- Slow-types rule is mandatory: every public exported function/type carries an explicit return type / shape annotation. No inference allowed on the public surface. This is enforced in CI via `pnpm dlx jsr publish --dry-run` (which fails on slow types).
- **TSDoc is mandatory on every public export.** JSR auto-generates the docs page on jsr.io from these comments. Required conventions:
  - Module-level `/** ... @module */` at the top of every `src/*.ts` file that re-exports (except `index.ts` which is a barrel).
  - Per-symbol TSDoc with at minimum a one-line summary. Public functions add `@param`, `@returns`, and `@throws` where relevant. Module files include at least one `@example` block showing real usage.
  - Cross-references via `{@link OtherSymbol}` where helpful (e.g. `createReplyAll` links to `createReply`).
  - No HTML in comments — JSR's renderer is Markdown-flavored.

## Testing Decisions

**What makes a good test here:** assert external behavior only — inputs and return values of the public functions. Never reach into a function's internal intermediate state. Use realistic fixtures, not contrived ones, wherever a regression target exists. Use synthetic minimal inputs only for edge cases that can't be expressed in a fixture (e.g., undefined dates, empty arrays).

**Modules to test:**

- `parsing.parseMessage` — fixtures for: plain-text, HTML-only, multipart mixed, inline images via cid, encoded display names, malformed Date, missing Message-ID, 10+ Received hops, duplicate DKIM-Signature.
- `parsing.extractThreadingHeaders` — synthetic inputs.
- `threading.buildThreads` — the JWZ implementation. Test against: single message, straight chain, branching reply tree, orphan children with shared missing parent (virtual root required), subject-fallback grouping with date windows, duplicates-by-message-id (dedup scoring), unordered input.
- `threading.ingestIntoThreads` — test: match via In-Reply-To, match via References, subject-fallback match, no match (new thread), immutability of input.
- `threading.getThreadId` — each of the three branches plus the orphan-synthesis path; assert determinism.
- `threading.normalizeSubject` — a table of prefix cases across all supported languages plus nested/repeated, bracketed, asterisk-wrapped.
- `composition.generateMessageId` — format regex assertion; uniqueness over 10k iterations; throw on invalid domain.
- `composition.buildReferences` — empty, short, at-cap, over-cap (assert first-3-last-17).
- `composition.quoteBody` — all four combinations of from/date presence; html vs text-only source.
- `composition.createReply` — subject dedup via `normalizeSubject` (including `Aw:`, `RV:` variants); `replyTo` vs `from`; `excludeAddresses` handling.
- `composition.createReplyAll` — dedup across To/Cc; exclude-all-recipients edge case; leaves-to-empty edge case.
- `composition.createForward` — subject `Fwd:`, References chain preserved, attachments copied, `throws` when content missing.
- `composition.createDraft` — empty threading fields, subject defaults.
- `addressing.parseAddress` / `parseAddressList` — bare, display-name, encoded-words, groups, multi, garbage.
- `addressing.formatAddress` — quoting special characters, no-name case.
- `addressing.isValidSingleAddress` / `isValidAddressList` — positive and negative cases.
- `addressing.deduplicateAddresses` / `excludeAddresses` — case-insensitivity, order preservation, first-seen-name retention.
- `content.extractBody`, `listAttachments`, `isInlineAttachment` — straight unit tests.

**Cross-cutting test requirements:**
- `ComposedMessage.raw` never contains `Bcc:` — assert across `createReply`, `createReplyAll`, `createForward`, `createDraft`.
- Tests must run under plain Vitest on Node; no Workers runtime.
- A fixtures directory committed to the repo containing real `.eml` files (anonymized). Each fixture filename documents what it exercises.

**Prior art:** none in-repo (greenfield). External reference patterns — `postal-mime`'s own test fixture layout and `jwz.c`/`JwzThreader.java` reference implementations for algorithm correctness.

## Out of Scope

- Sending email (transport, SMTP, Cloudflare Email binding).
- Storing email (D1, R2, any DB or blob store).
- Fetching email (IMAP, POP3, Gmail API, Microsoft Graph).
- HTML sanitization (DOMPurify lives in the rendering layer).
- Authentication / DKIM / SPF verification (out of v1; signature strings are preserved in headers for later verification).
- Full-text search / indexing.
- Encryption / S/MIME / PGP.
- Rich-text editor integration.
- Attachment virus scanning.
- Spam scoring.
- Deliverability diagnostics beyond what's visible in headers.
- Locale-aware or timezone-aware date formatting in `quoteBody` (ISO 8601 UTC only).

## Further Notes

- **Versioning:** v1.0.0 is this release. Breaking changes in types (`headers` shape, `Attachment.content` optionality, `ThreadNode` shape) are intentional; no earlier version exists to break.
- **Package structure:** a single package at repo root is simpler than the `packages/mail-utils/` nested layout in the original spec unless a monorepo materializes. Use the flat layout; revisit if multiple packages emerge.
- **Backwards-compat with the original spec:** the resolved decisions intentionally diverge from the literal text of the original spec where it was under-specified or contradictory. The decisions here are authoritative.
- **Docs:** a `README.md` with a one-liner per function and a usage example per module is in scope. Extended API docs can be generated from TSDoc later; not blocking v1.
