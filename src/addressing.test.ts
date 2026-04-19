import { describe, expect, it } from "vitest";

import {
  deduplicateAddresses,
  excludeAddresses,
  formatAddress,
  isValidAddressList,
  isValidSingleAddress,
  parseAddress,
  parseAddressList,
} from "./addressing.ts";

describe("parseAddress", () => {
  it("parses a bare address", () => {
    expect(parseAddress("ada@example.com")).toEqual({
      address: "ada@example.com",
    });
  });

  it("parses a display name + address", () => {
    expect(parseAddress('"Ada Lovelace" <ada@example.com>')).toEqual({
      name: "Ada Lovelace",
      address: "ada@example.com",
    });
  });

  it("returns the first mailbox when given a list", () => {
    expect(parseAddress("ada@example.com, grace@example.com")).toEqual({
      address: "ada@example.com",
    });
  });

  it("flattens a group, returning the first member", () => {
    expect(parseAddress("Team: ada@example.com, grace@example.com;")).toEqual({
      address: "ada@example.com",
    });
  });

  it("decodes RFC 2047 encoded display names (UTF-8 B)", () => {
    expect(
      parseAddress("=?UTF-8?B?QcOsZGEgTG92ZWxhY2U=?= <ada@example.com>"),
    ).toEqual({ name: "Aìda Lovelace", address: "ada@example.com" });
  });

  it("decodes RFC 2047 encoded display names (UTF-8 Q, underscore = space)", () => {
    expect(parseAddress("=?UTF-8?Q?Ada_Lovelace?= <ada@example.com>")).toEqual({
      name: "Ada Lovelace",
      address: "ada@example.com",
    });
  });

  it("returns undefined on garbage input", () => {
    expect(parseAddress("not an address")).toBeUndefined();
    expect(parseAddress("")).toBeUndefined();
  });

  it("strips empty display names", () => {
    // A quoted empty name should come back as address-only, not { name: "" }.
    const result = parseAddress('"" <ada@example.com>');

    expect(result).toEqual({ address: "ada@example.com" });
  });
});

describe("parseAddressList", () => {
  it("parses multi-address lists", () => {
    expect(
      parseAddressList("Ada <ada@example.com>, grace@example.com"),
    ).toEqual([
      { name: "Ada", address: "ada@example.com" },
      { address: "grace@example.com" },
    ]);
  });

  it("flattens groups into their members", () => {
    expect(
      parseAddressList("Team: ada@example.com, grace@example.com;"),
    ).toEqual([
      { address: "ada@example.com" },
      { address: "grace@example.com" },
    ]);
  });

  it("returns [] on parse failure", () => {
    expect(parseAddressList("not an address")).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
  });

  it("preserves order", () => {
    const result = parseAddressList("c@x.com, a@x.com, b@x.com");

    expect(result.map((r) => r.address)).toEqual([
      "c@x.com",
      "a@x.com",
      "b@x.com",
    ]);
  });
});

describe("formatAddress", () => {
  it("serializes address-only entries as the bare address", () => {
    expect(formatAddress({ address: "ada@example.com" })).toBe(
      "ada@example.com",
    );
  });

  it("serializes simple display names without quoting", () => {
    expect(
      formatAddress({ name: "Ada Lovelace", address: "ada@example.com" }),
    ).toBe("Ada Lovelace <ada@example.com>");
  });

  it("quotes names containing commas", () => {
    expect(
      formatAddress({ name: "Lovelace, Ada", address: "ada@example.com" }),
    ).toBe('"Lovelace, Ada" <ada@example.com>');
  });

  it("escapes internal quotes and backslashes", () => {
    expect(
      formatAddress({
        name: 'Ada "Countess" Lovelace',
        address: "ada@example.com",
      }),
    ).toBe('"Ada \\"Countess\\" Lovelace" <ada@example.com>');
  });

  it("quotes names containing parentheses or angle brackets", () => {
    expect(
      formatAddress({ name: "Ada (the Countess)", address: "ada@example.com" }),
    ).toBe('"Ada (the Countess)" <ada@example.com>');
  });

  it("treats an empty name as address-only", () => {
    expect(formatAddress({ name: "", address: "ada@example.com" })).toBe(
      "ada@example.com",
    );
  });

  it("returns empty string for an empty address (documented, not validated)", () => {
    expect(formatAddress({ address: "" })).toBe("");
  });

  it.each([
    ["semicolon", "Team; Ada"],
    ["colon", "Ada: Lovelace"],
    ["at-sign", "Ada @ Work"],
    ["left angle", "Ada <the Countess"],
    ["right angle", "Ada the Countess>"],
    ["left bracket", "Ada [the Countess]"],
    ["tab", "Ada\tLovelace"],
    ["newline", "Ada\nLovelace"],
    ["del", "Ada\x7fLovelace"],
  ])("quotes names containing %s", (_label, name) => {
    const result = formatAddress({ name, address: "ada@example.com" });

    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith("<ada@example.com>")).toBe(true);
  });
});

describe("formatAddress + parseAddress round-trip", () => {
  const fixtures: ReadonlyArray<{ name: string; address: string }> = [
    { name: "Ada Lovelace", address: "ada@example.com" },
    { name: "Lovelace, Ada", address: "ada@example.com" },
    { name: 'Ada "Countess" Lovelace', address: "ada@example.com" },
    { name: "Ada (the Countess)", address: "ada@example.com" },
    { name: "Ada: Lovelace", address: "ada@example.com" },
    { name: "Ada; Lovelace", address: "ada@example.com" },
    { name: "Ada\\Lovelace", address: "ada@example.com" },
  ];

  it.each(fixtures)(
    "round-trips formatAddress -> parseAddress for $name",
    (input) => {
      const serialized = formatAddress(input);
      const parsed = parseAddress(serialized);

      expect(parsed).toEqual(input);
    },
  );
});

describe("isValidSingleAddress", () => {
  it("accepts a single mailbox", () => {
    expect(isValidSingleAddress("ada@example.com")).toBe(true);
    expect(isValidSingleAddress('"Ada" <ada@example.com>')).toBe(true);
  });

  it("rejects multi-mailbox lists", () => {
    expect(isValidSingleAddress("ada@x.com, grace@x.com")).toBe(false);
  });

  it("rejects groups (not a single mailbox)", () => {
    expect(isValidSingleAddress("Team: ada@x.com, grace@x.com;")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidSingleAddress("not an address")).toBe(false);
    expect(isValidSingleAddress("")).toBe(false);
  });
});

describe("isValidAddressList", () => {
  it("accepts one or more mailboxes", () => {
    expect(isValidAddressList("ada@example.com")).toBe(true);
    expect(isValidAddressList("ada@x.com, grace@x.com")).toBe(true);
    expect(isValidAddressList("Team: ada@x.com, grace@x.com;")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidAddressList("not an address")).toBe(false);
    expect(isValidAddressList("")).toBe(false);
  });

  it("rejects an empty group with no mailboxes", () => {
    expect(isValidAddressList("Team:;")).toBe(false);
  });
});

describe("deduplicateAddresses", () => {
  it("dedupes case-insensitively on address", () => {
    const result = deduplicateAddresses([
      { name: "Ada", address: "ada@example.com" },
      { address: "ADA@example.com" },
      { address: "grace@example.com" },
    ]);

    expect(result).toEqual([
      { name: "Ada", address: "ada@example.com" },
      { address: "grace@example.com" },
    ]);
  });

  it("retains the name from the first occurrence", () => {
    const result = deduplicateAddresses([
      { name: "Ada", address: "ada@x.com" },
      { name: "A. Lovelace", address: "ada@x.com" },
    ]);

    expect(result).toEqual([{ name: "Ada", address: "ada@x.com" }]);
  });

  it("preserves original order", () => {
    const result = deduplicateAddresses([
      { address: "c@x.com" },
      { address: "a@x.com" },
      { address: "c@x.com" },
      { address: "b@x.com" },
    ]);

    expect(result.map((r) => r.address)).toEqual([
      "c@x.com",
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("handles empty input", () => {
    expect(deduplicateAddresses([])).toEqual([]);
  });
});

describe("excludeAddresses", () => {
  it("filters case-insensitively", () => {
    const result = excludeAddresses(
      [{ address: "ada@x.com" }, { address: "grace@x.com" }],
      ["ADA@x.com"],
    );

    expect(result).toEqual([{ address: "grace@x.com" }]);
  });

  it("is a no-op when exclude is empty", () => {
    const input = [{ address: "ada@x.com" }];
    const result = excludeAddresses(input, []);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("can produce an empty result", () => {
    expect(
      excludeAddresses(
        [{ address: "ada@x.com" }],
        ["ada@x.com", "grace@x.com"],
      ),
    ).toEqual([]);
  });

  it("preserves order of remaining entries", () => {
    const result = excludeAddresses(
      [
        { address: "a@x.com" },
        { address: "b@x.com" },
        { address: "c@x.com" },
      ],
      ["b@x.com"],
    );

    expect(result.map((r) => r.address)).toEqual(["a@x.com", "c@x.com"]);
  });
});
