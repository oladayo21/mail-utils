# CLAUDE.md — @oflabs/mail-utils

Platform-agnostic TS utility library for email parsing, threading, composition. Runs in Workers, Node, Deno, Bun, browsers. No I/O, no storage, no platform bindings.

## Authority

- **[PRD.md](./PRD.md)** is the authoritative spec. Read it before implementing anything.
- Spec decisions from the /grll-me interview live in `~/.claude/projects/-Users-oladayo-fagbemi-code-oflabs-email-utils/memory/` — check MEMORY.md for the index. Do not re-litigate decisions captured there.
- GitHub issues tagged `prd/mail-utils-v1` = the work queue. Issues 1–8.

## Design rules (non-negotiable)

1. **Platform-agnostic.** No `node:*` imports. No `Buffer`, `fs`, `path`, `process`. Use `globalThis.crypto` for randomness, `ArrayBuffer` / `Uint8Array` for binary data.
2. **Sync everywhere except `parseMessage`.** No `Promise<T>` returns outside that one function.
3. **Named exports only.** No default exports. No classes. No global state.
4. **No throws on bad email data.** Return `undefined`, `[]`, `""`. Exception: caller errors (invalid domain, missing attachment content on forward) throw loudly.
5. **No mutation of inputs.** Every function returns new objects/arrays.
6. **Explicit return types on every public export.** JSR slow-types rule blocks publish otherwise.
7. **TSDoc on every public export.** Module-level `@module` + symbol-level `@param`/`@returns`/`@throws`/`@example`. JSR renders these on jsr.io.
8. **No `sanitizeHtml`.** Sanitization is the caller's concern.

## Publishing

- JSR only at `@oflabs/mail-utils`. No npm, no `dist/`, no build step.
- `tsconfig.json` has `noEmit: true` — tsc is type-check only. JSR consumes raw `.ts`.
- Release: bump `jsr.json` version → commit → `git tag v0.x.y && git push --tags` → OIDC-authenticated GitHub Actions publishes.
- Local dry-run: `make publish-jsr-dry`. Catches slow-types before CI.

## Per-issue workflow

After finishing implementation for an issue (before commit):

1. Run PR-review toolkit on the diff: invoke the `pr-review-toolkit:review-pr` skill.
2. Run simplify on the diff: invoke the `simplify` skill.
3. Address the findings — resolve or defend each one, don't ignore.
4. Re-run typecheck + tests: `make typecheck && make test`.
5. Commit with a changelog-style message (see `~/CLAUDE.md` PR rules — description is for humans).
6. Close the corresponding issue in the commit trailer (`Closes #N`).

Skip this workflow only for doc-only changes that touch no code.

## Commands

```sh
make install         # pnpm install
make test            # vitest run
make test-watch      # vitest watch
make typecheck       # tsc --noEmit
make publish-jsr-dry # dry-run JSR publish
make publish-jsr     # real publish (normally CI-only)
```

Do not run `pnpm` scripts directly — go through `make`.

## Code style

- Follows `~/CLAUDE.md` JS/TS rules: empty line before `if`, `return`, `throw`.
- Extreme brevity. No filler comments. Comments explain non-obvious *why*, never *what*.
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Don't relax.
- No emojis anywhere.

## Testing

- Vitest. Runs on plain Node — no platform runtime.
- Fixtures in `tests/fixtures/` (see issue #8).
- Test external behavior only, never internal state.
- Internal deep modules (`jwz-tree-builder`, `subject-normalizer`, `references-builder`, `quote-body`, `message-id-generator`, `orphan-id-synthesizer`) should be tested in isolation with synthetic inputs, not only through the public surface.

## Dependencies

Runtime: `postal-mime`, `mimetext`, `email-addresses`. That's it. Do not add more without strong justification — every dep is a platform-compat risk.

Dev: `typescript`, `vitest`, `@types/node`. That's it.
