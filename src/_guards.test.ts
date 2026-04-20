// Cross-cutting guard tests: enforce the contract from PRD §"Cross-
// cutting contracts" — platform-agnostic surface, named exports only,
// no Node built-ins in production code.
//
// Runs under plain Vitest on Node; uses `node:fs` to walk the tree.
// Tests themselves are allowed to use node built-ins; only production
// files (non-`.test.ts`) are scanned.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC_ROOT = new URL("../src/", import.meta.url).pathname;

type SourceFile = { path: string; relative: string; content: string };

function walkSources(): SourceFile[] {
  const out: SourceFile[] = [];

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}${entry}`;

      if (statSync(full).isDirectory()) {
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

describe("cross-cutting guards — platform-agnostic surface", () => {
  it("discovers production sources (sanity)", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it("no production file imports from `node:*`", () => {
    const offenders = SOURCES.filter((f) =>
      /from\s+['"]node:[^'"]+['"]/.test(f.content),
    ).map((f) => f.relative);

    expect(offenders).toEqual([]);
  });

  it("no production file uses the Node `Buffer` global", () => {
    // Match `Buffer.` or `new Buffer(` identifier use, not the word
    // "Buffer" in a comment or string.
    const pattern = /(?<![A-Za-z0-9_])Buffer(?:\.|\s*\()/;
    const offenders = SOURCES.filter((f) => pattern.test(f.content)).map(
      (f) => f.relative,
    );

    expect(offenders).toEqual([]);
  });

  it("no production file reads `process.env` or `process.`", () => {
    const pattern = /(?<![A-Za-z0-9_])process\./;
    const offenders = SOURCES.filter((f) => pattern.test(f.content)).map(
      (f) => f.relative,
    );

    expect(offenders).toEqual([]);
  });
});

describe("cross-cutting guards — named exports only", () => {
  it("no production file uses `export default`", () => {
    const pattern = /^\s*export\s+default\b/m;
    const offenders = SOURCES.filter((f) => pattern.test(f.content)).map(
      (f) => f.relative,
    );

    expect(offenders).toEqual([]);
  });

  it("public barrel (`src/index.ts`) exports named members only", () => {
    const barrel = SOURCES.find((f) => f.relative === "index.ts");

    expect(barrel).toBeDefined();
    // No `export default` and no `export =` (CJS-ish syntax) either.
    expect(/export\s+default\b/.test(barrel!.content)).toBe(false);
    expect(/export\s*=\s/.test(barrel!.content)).toBe(false);
  });
});
