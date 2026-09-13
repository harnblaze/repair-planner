import { describe, expect, it } from "vitest";
import { cn, safeNextPath } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });

  it("drops falsy values", () => {
    expect(cn("p-2", false && "hidden", undefined, "text-sm")).toBe("p-2 text-sm");
  });
});

describe("safeNextPath", () => {
  it("keeps paths inside the application", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/p1/board?week=2026-09-14")).toBe("/p1/board?week=2026-09-14");
  });

  it("falls back to projects for missing or external targets", () => {
    expect(safeNextPath(undefined)).toBe("/projects");
    expect(safeNextPath("")).toBe("/projects");
    expect(safeNextPath("https://evil.example")).toBe("/projects");
    expect(safeNextPath("//evil.example")).toBe("/projects");
    expect(safeNextPath("/\\evil.example")).toBe("/projects");
    expect(safeNextPath(`/${String.fromCharCode(9)}/evil.example`)).toBe("/projects");
  });
});
