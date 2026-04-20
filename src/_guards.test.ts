// Cross-cutting guard tests: enforce the contract from PRD §"Cross-
// cutting contracts" — platform-agnostic surface, named exports only,
// no Node built-ins in production code.
//
// Runs under plain Vitest on Node; uses `node:fs` to walk the tree.
// Tests themselves are allowed to use node built-ins; only production
// files (non-`.test.ts`) are scanned.

import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC_ROOT = new URL("../src/", import.meta.url).pathname;

type SourceFile = { path: string; relative: string; content: string };

function walkSources(): SourceFile[] {
  const out: SourceFile[] = [];

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir)) {
      // Skip hidden dirs and node_modules just in case someone ever
      // symlinks one into src/.
      if (entry.startsWith(".") || entry === "node_modules") {
        continue;
      }

      const full = `${dir}${entry}`;
      // lstat so we don't follow symlinks — a loop would hang the run.
      const info = lstatSync(full);

      if (info.isSymbolicLink()) {
        continue;
      }

      if (info.isDirectory()) {
        walk(`${full}/`, `${prefix}${entry}/`);

        continue;
      }

      if (!entry.endsWith(".ts")) {
        continue;
      }

      if (entry.endsWith(".test.ts")) {
        continue;
      }

      out.push({
        path: full,
        relative: `${prefix}${entry}`,
        content: readFileSync(full, "utf8"),
      });
    }
  }

  walk(SRC_ROOT, "");

  return out;
}

const SOURCES = walkSources();

// Every Node.js core module — both as `node:*` specifier and (on
// older style) as a bare specifier. A bare `from "fs"` ships a
// platform-locked dep just as surely as `from "node:fs"` does, so
// both forms are forbidden.
const NODE_BUILTINS = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

function escapeForRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SPECIFIER = `(?:node:[\\w/-]+|${NODE_BUILTINS.map(escapeForRegex).join(
  "|",
)})`;

// Catches every import shape: `from "x"`, `import "x"`, dynamic
// `import("x")`, CJS `require("x")`, and `export * from "x"`
// (which goes through the same `from` branch).
const NODE_IMPORT_PATTERN = new RegExp(
  `(?:from\\s+|import\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${SPECIFIER}['"]`,
  "g",
);

describe("cross-cutting guards — platform-agnostic surface", () => {
  it("discovers production sources including the public barrel (sanity)", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    // Silent-walk-regression guard: if the walk breaks, every scan
    // below trivially passes — anchor the sanity check to a file we
    // know must exist.
    expect(SOURCES.map((f) => f.relative)).toContain("index.ts");
  });

  it("no production file imports a Node built-in (any import shape)", () => {
    const offenders = SOURCES.filter((f) => NODE_IMPORT_PATTERN.test(f.content))
      .map((f) => f.relative);

    expect(offenders).toEqual([]);
  });

  it("no production file references the Node `Buffer` identifier", () => {
    // `\bBuffer\b` catches `Buffer.from`, `new Buffer(`, `instanceof
    // Buffer`, `globalThis.Buffer`, destructured `const { Buffer }`.
    const offenders = SOURCES.filter((f) => /\bBuffer\b/.test(f.content)).map(
      (f) => f.relative,
    );

    expect(offenders).toEqual([]);
  });

  it("no production file references `process.` (including via globalThis)", () => {
    // `\bprocess\b(?=\.)` catches `process.env`, `globalThis.process.X`,
    // and `global.process.X`.
    const offenders = SOURCES.filter((f) =>
      /\bprocess\b(?=\.)/.test(f.content),
    ).map((f) => f.relative);

    expect(offenders).toEqual([]);
  });
});

describe("cross-cutting guards — named exports only", () => {
  it("no production file uses `export default` (any form)", () => {
    const patterns: ReadonlyArray<RegExp> = [
      // `export default ...`
      /^\s*export\s+default\b/m,
      // `export { default } from ...` or `export { default as foo }`
      /export\s*\{[^}]*\bdefault\b[^}]*\}/,
      // `export { foo as default }`
      /\bas\s+default\b/,
      // CJS-ish `export = X`
      /^\s*export\s*=\s*/m,
    ];
    const offenders = SOURCES.filter((f) =>
      patterns.some((p) => p.test(f.content)),
    ).map((f) => f.relative);

    expect(offenders).toEqual([]);
  });
});
