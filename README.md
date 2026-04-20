# @oflabs/email-utils

Platform-agnostic TypeScript utilities for email parsing, threading, and composition.

Runs unchanged in Cloudflare Workers, Node.js, Deno, Bun, browsers, and any test runner. No I/O, no storage, no platform bindings. Pure functions in, plain data out.

> Status: **pre-v1, under active development.** See [PRD.md](./PRD.md) and the open issues for scope.

## Install

Published on [JSR](https://jsr.io/@oflabs/email-utils).

```sh
deno add jsr:@oflabs/email-utils
# or
pnpm dlx jsr add @oflabs/email-utils
# or
bunx jsr add @oflabs/email-utils
```

## Modules

- **`parsing`** — `parseMessage`, `extractThreadingHeaders`
- **`threading`** — `buildThreads`, `ingestIntoThreads`, `getThreadId`, `normalizeSubject`
- **`composition`** — `createReply`, `createReplyAll`, `createForward`, `createDraft`, `generateMessageId`, `buildReferences`, `quoteBody`
- **`addressing`** — `parseAddress`, `parseAddressList`, `formatAddress`, `isValidSingleAddress`, `isValidAddressList`, `deduplicateAddresses`, `excludeAddresses`
- **`content`** — `extractBody`, `listAttachments`, `isInlineAttachment`

All functions are synchronous except `parseMessage`. All functions are individually importable via named exports.

## License

MIT
