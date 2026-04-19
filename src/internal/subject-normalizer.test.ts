import { describe, expect, it } from "vitest";

import { normalizeSubject } from "./subject-normalizer.ts";

describe("normalizeSubject — reply prefixes", () => {
  it.each([
    ["Re: hi", "hi"],
    ["RE: hi", "hi"],
    ["re: hi", "hi"],
    ["Re : hi", "hi"],
    ["Re[2]: hi", "hi"],
    ["Aw: hi", "hi"], // German
    ["Rép: bonjour", "bonjour"], // French
    ["Ré: bonjour", "bonjour"],
    ["RV: hola", "hola"], // Spanish
    ["Ref: hola", "hola"],
    // Single-letter `R:` / `I:` are intentionally NOT stripped — they
    // alias too broadly (e.g. "r: rocket" would lose its first word).
    ["Antw: hallo", "hallo"], // Dutch
    ["Odp: cześć", "cześć"], // Polish
    ["Sv: hej", "hej"], // Swedish
    ["SV: hej", "hej"],
  ])("strips %s", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });
});

describe("normalizeSubject — forward prefixes", () => {
  it.each([
    ["Fwd: hi", "hi"],
    ["FWD: hi", "hi"],
    ["Fw: hi", "hi"],
    ["Wg: hi", "hi"], // German
    ["Tr: bonjour", "bonjour"], // French
    ["Rif: ciao", "ciao"], // Italian (use long form; single-letter `I:` dropped)
    ["Enc: olá", "olá"], // Portuguese
    ["Doorst: hallo", "hallo"], // Dutch
    ["PD: cześć", "cześć"], // Polish
    ["Vs: hej", "hej"], // Swedish
  ])("strips %s", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });
});

describe("normalizeSubject — bracket markers", () => {
  it("strips [External]", () => {
    expect(normalizeSubject("[External] Meeting")).toBe("Meeting");
  });

  it("strips [EXT]", () => {
    expect(normalizeSubject("[EXT] Meeting")).toBe("Meeting");
  });

  it("strips [SPAM]", () => {
    expect(normalizeSubject("[SPAM] Meeting")).toBe("Meeting");
  });

  it("strips [Suspicious Sender]", () => {
    expect(normalizeSubject("[Suspicious Sender] Meeting")).toBe("Meeting");
  });
});

describe("normalizeSubject — asterisk markers", () => {
  it("strips ***SPAM***", () => {
    expect(normalizeSubject("***SPAM*** Meeting")).toBe("Meeting");
  });

  it("strips **URGENT**", () => {
    expect(normalizeSubject("**URGENT** Meeting")).toBe("Meeting");
  });
});

describe("normalizeSubject — nested / repeated", () => {
  it("strips Re: Fwd: Re: nested prefixes", () => {
    expect(normalizeSubject("Re: Fwd: Re: Meeting tomorrow")).toBe(
      "Meeting tomorrow",
    );
  });

  it("strips mixed-language prefixes", () => {
    expect(normalizeSubject("Re: Aw: Fwd: Meeting")).toBe("Meeting");
  });

  it("strips bracket + prefix + bracket combos", () => {
    expect(normalizeSubject("[EXT] Re: [SPAM] Meeting")).toBe("Meeting");
  });

  it("caps iterations and does not hang on pathological input", () => {
    const pathological = "Re: ".repeat(50) + "end";
    const result = normalizeSubject(pathological);

    expect(result.endsWith("end")).toBe(true);
  });
});

describe("normalizeSubject — intentional non-strippers", () => {
  it("does not strip bare `R:` (would mangle legitimate subjects)", () => {
    expect(normalizeSubject("R: rocket launch")).toBe("R: rocket launch");
  });

  it("does not strip bare `I:` (same reason)", () => {
    expect(normalizeSubject("I: important update")).toBe(
      "I: important update",
    );
  });
});

describe("normalizeSubject — edge cases", () => {
  it("returns empty string unchanged", () => {
    expect(normalizeSubject("")).toBe("");
  });

  it("returns empty string on non-string input", () => {
    // @ts-expect-error — intentionally passing non-string for runtime behavior.
    expect(normalizeSubject(null)).toBe("");
    // @ts-expect-error — intentionally passing non-string for runtime behavior.
    expect(normalizeSubject(undefined)).toBe("");
  });

  it("leaves a subject with no prefix unchanged", () => {
    expect(normalizeSubject("Meeting tomorrow")).toBe("Meeting tomorrow");
  });

  it("trims whitespace", () => {
    expect(normalizeSubject("   Meeting   ")).toBe("Meeting");
  });
});
