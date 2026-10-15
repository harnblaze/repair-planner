import { describe, expect, it } from "vitest";

import { executorsInitials, executorsSummary } from "./executor-names";

describe("executorsSummary", () => {
  it("says nobody is assigned when the list is empty", () => {
    expect(executorsSummary([])).toBe("Не назначены");
  });

  it("shows a single executor's full name", () => {
    expect(executorsSummary(["Иванов Иван"])).toBe("Иванов Иван");
  });

  it("shortens several executors to surname and initials", () => {
    expect(executorsSummary(["Иванов Иван", "Петров Пётр Петрович"])).toBe("Иванов И., Петров П. П.");
  });

  it("keeps one-word names as they are and ignores extra spaces", () => {
    expect(executorsSummary(["  Сидоров ", "Кузнецов   Олег"])).toBe("Сидоров, Кузнецов О.");
  });
});

describe("executorsInitials", () => {
  it("is empty when nobody is assigned", () => {
    expect(executorsInitials([])).toBe("");
  });

  it("shows even a single executor as surname and first initial", () => {
    expect(executorsInitials(["Иванов Иван Иванович"])).toBe("Иванов И.");
  });

  it("keeps one-word names and ignores extra spaces", () => {
    expect(executorsInitials(["  Сидоров ", "Кузнецов   Олег"])).toBe("Сидоров, Кузнецов О.");
  });

  it("lists two executors and counts the rest", () => {
    expect(executorsInitials(["Иванов Иван", "Петров Пётр", "Сидоров Сидор", "Кузнецов Олег"])).toBe(
      "Иванов И., Петров П. +2",
    );
  });
});
