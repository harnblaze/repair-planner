import { describe, expect, it } from "vitest";

import { confirmsProjectName } from "./project-archive";

describe("confirmsProjectName", () => {
  it("accepts the exact name", () => {
    expect(confirmsProjectName("Работа", "Работа")).toBe(true);
  });

  it("ignores surrounding spaces", () => {
    expect(confirmsProjectName("  Работа ", "Работа")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(confirmsProjectName("работа", "Работа")).toBe(false);
  });

  it("rejects an empty input", () => {
    expect(confirmsProjectName("   ", "Работа")).toBe(false);
  });
});
