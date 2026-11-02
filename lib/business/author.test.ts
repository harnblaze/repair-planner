import { describe, expect, it } from "vitest";

import { authorFullName, authorLabel, formatAuthorName, toAuthorMap, UNKNOWN_AUTHOR } from "./author";

describe("formatAuthorName", () => {
  it("shortens a full name to surname and initials", () => {
    expect(formatAuthorName("Иванов Иван Иванович")).toBe("Иванов И. И.");
  });

  it("uses the first initial when only two words are given", () => {
    expect(formatAuthorName("Иванов Иван")).toBe("Иванов И.");
  });

  it("keeps a one-word name as it is", () => {
    expect(formatAuthorName("Сергей")).toBe("Сергей");
  });

  it("keeps a hyphenated surname in one piece", () => {
    expect(formatAuthorName("Иванов-Петров Иван")).toBe("Иванов-Петров И.");
  });

  it("ignores extra spaces around and between words", () => {
    expect(formatAuthorName("  Иванов   Иван  ")).toBe("Иванов И.");
  });

  it("says the name is unknown when the profile has none", () => {
    expect(formatAuthorName("")).toBe(UNKNOWN_AUTHOR);
    expect(formatAuthorName("   ")).toBe(UNKNOWN_AUTHOR);
    expect(formatAuthorName(null)).toBe(UNKNOWN_AUTHOR);
    expect(formatAuthorName(undefined)).toBe(UNKNOWN_AUTHOR);
  });
});

describe("toAuthorMap and lookups", () => {
  const names = toAuthorMap([
    { user_id: "u-1", full_name: "Иванов Иван Иванович" },
    { user_id: "u-2", full_name: null },
  ]);

  it("builds a lookup of raw full names", () => {
    expect(names.get("u-1")).toBe("Иванов Иван Иванович");
    expect(names.get("u-2")).toBeNull();
  });

  it("formats a label by user id", () => {
    expect(authorLabel(names, "u-1")).toBe("Иванов И. И.");
  });

  it("falls back to the unknown label when the profile has no name", () => {
    expect(authorLabel(names, "u-2")).toBe(UNKNOWN_AUTHOR);
  });

  it("has no label without an author id", () => {
    expect(authorLabel(names, null)).toBeNull();
    expect(authorLabel(names, undefined)).toBeNull();
  });

  it("has no label for a user who is no longer in the project", () => {
    expect(authorLabel(names, "u-gone")).toBe(UNKNOWN_AUTHOR);
  });

  it("returns the raw full name for the tooltip", () => {
    expect(authorFullName(names, "u-1")).toBe("Иванов Иван Иванович");
    expect(authorFullName(names, "u-2")).toBeNull();
    expect(authorFullName(names, null)).toBeNull();
  });

  it("tolerates a missing member list", () => {
    expect(toAuthorMap(null).size).toBe(0);
    expect(authorLabel(toAuthorMap(undefined), "u-1")).toBe(UNKNOWN_AUTHOR);
  });
});
