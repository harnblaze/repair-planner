import { describe, expect, it } from "vitest";

import { canCarryOverTask, isCarriedOverOccurrence } from "./task-planning";

describe("canCarryOverTask", () => {
  it("разрешает перенос незавершённой задачи", () => {
    expect(canCarryOverTask("new")).toBe(true);
    expect(canCarryOverTask("planned")).toBe(true);
    expect(canCarryOverTask("in_progress")).toBe(true);
    expect(canCarryOverTask("paused")).toBe(true);
  });

  it("запрещает перенос завершённой или отменённой задачи", () => {
    expect(canCarryOverTask("completed")).toBe(false);
    expect(canCarryOverTask("cancelled")).toBe(false);
  });
});

describe("isCarriedOverOccurrence", () => {
  it("false для последнего (текущего) дня работы", () => {
    expect(isCarriedOverOccurrence("2026-09-15", "2026-09-15")).toBe(false);
  });

  it("true для дня, после которого задача была перенесена дальше", () => {
    expect(isCarriedOverOccurrence("2026-09-14", "2026-09-15")).toBe(true);
  });

  it("false, если задача сейчас не запланирована", () => {
    expect(isCarriedOverOccurrence("2026-09-14", null)).toBe(false);
  });
});
