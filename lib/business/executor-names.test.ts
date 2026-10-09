import { describe, expect, it } from "vitest";

import { executorsSummary } from "./executor-names";

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
