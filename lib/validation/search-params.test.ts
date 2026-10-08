import { describe, expect, it } from "vitest";
import { z } from "zod";

import { SEARCH_QUERY_MAX, firstParam, parseParam, parseSearchText } from "./search-params";

describe("firstParam", () => {
  it("строка — как есть, повторяющийся параметр — первый", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("parseParam", () => {
  it("неверное значение — значение по умолчанию", () => {
    const schema = z.enum(["x", "y"]);
    expect(parseParam(schema, "y", null)).toBe("y");
    expect(parseParam(schema, "z", null)).toBeNull();
    expect(parseParam(schema, undefined, "x")).toBe("x");
  });
});

describe("parseSearchText", () => {
  it("обрезает пробелы и длину", () => {
    expect(parseSearchText(["  насос ", "x"])).toBe("насос");
    expect(parseSearchText(undefined)).toBe("");
    expect(parseSearchText("я".repeat(150))).toHaveLength(SEARCH_QUERY_MAX);
  });
});
