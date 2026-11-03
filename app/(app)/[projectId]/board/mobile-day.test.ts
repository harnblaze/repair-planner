import { describe, expect, it } from "vitest";

import { initialActiveDay, resolveActiveDay } from "./mobile-day";

// Неделя как её отдаёт weekBoardDays: Пн–Пт и, если суббота рабочая, шестой день.
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const WEEK_WITH_SATURDAY = [...WEEK, "2026-11-07"];

describe("initialActiveDay", () => {
  it("выбирает сегодня, если он в этой неделе", () => {
    expect(initialActiveDay(WEEK, "2026-11-04")).toBe("2026-11-04");
  });

  it("рабочую субботу тоже выбирает", () => {
    expect(initialActiveDay(WEEK_WITH_SATURDAY, "2026-11-07")).toBe("2026-11-07");
  });

  it("сегодня вне недели (воскресенье) — первый день недели", () => {
    expect(initialActiveDay(WEEK, "2026-11-08")).toBe("2026-11-02");
  });

  it("сегодня вне недели (прошлая неделя) — первый день недели", () => {
    expect(initialActiveDay(WEEK, "2026-10-28")).toBe("2026-11-02");
  });

  it("пустой список дней — null", () => {
    expect(initialActiveDay([], "2026-11-04")).toBeNull();
  });
});

describe("resolveActiveDay", () => {
  it("сохраняет выбранный день, пока он в неделе", () => {
    expect(resolveActiveDay(WEEK, "2026-11-04", "2026-11-06")).toBe("2026-11-06");
  });

  it("выбранный день из другой недели заменяется на сегодня", () => {
    expect(resolveActiveDay(WEEK, "2026-11-04", "2026-10-28")).toBe("2026-11-04");
  });

  it("без выбора работает как initialActiveDay", () => {
    expect(resolveActiveDay(WEEK, "2026-11-03", null)).toBe("2026-11-03");
  });

  it("пустая неделя — null даже при выбранном дне", () => {
    expect(resolveActiveDay([], "2026-11-03", "2026-11-03")).toBeNull();
  });
});
