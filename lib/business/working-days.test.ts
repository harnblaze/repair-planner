import { describe, expect, it } from "vitest";

import {
  addWeeks,
  isWorkingDay,
  mondayOf,
  nextWorkingDay,
  weekWorkingDays,
} from "./working-days";

describe("isWorkingDay", () => {
  it("считает Пн–Пт рабочими днями", () => {
    expect(isWorkingDay("2026-09-14")).toBe(true); // Пн
    expect(isWorkingDay("2026-09-18")).toBe(true); // Пт
  });

  it("считает Сб и Вс выходными", () => {
    expect(isWorkingDay("2026-09-19")).toBe(false); // Сб
    expect(isWorkingDay("2026-09-20")).toBe(false); // Вс
  });
});

describe("nextWorkingDay", () => {
  it("для будних дней (кроме пятницы) возвращает следующий календарный день", () => {
    expect(nextWorkingDay("2026-09-14")).toBe("2026-09-15"); // Пн → Вт
    expect(nextWorkingDay("2026-09-17")).toBe("2026-09-18"); // Чт → Пт
  });

  it("пятница → понедельник", () => {
    expect(nextWorkingDay("2026-09-18")).toBe("2026-09-21");
  });

  it("суббота → понедельник", () => {
    expect(nextWorkingDay("2026-09-19")).toBe("2026-09-21");
  });

  it("воскресенье → понедельник", () => {
    expect(nextWorkingDay("2026-09-20")).toBe("2026-09-21");
  });
});

describe("mondayOf", () => {
  it("для любого дня недели возвращает её понедельник", () => {
    expect(mondayOf("2026-09-14")).toBe("2026-09-14"); // сам понедельник
    expect(mondayOf("2026-09-18")).toBe("2026-09-14"); // пятница той же недели
    expect(mondayOf("2026-09-20")).toBe("2026-09-14"); // воскресенье той же недели
  });
});

describe("weekWorkingDays", () => {
  it("возвращает Пн–Пт начиная с переданного понедельника", () => {
    expect(weekWorkingDays("2026-09-14")).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });
});

describe("addWeeks", () => {
  it("сдвигает понедельник на N недель вперёд/назад", () => {
    expect(addWeeks("2026-09-14", 1)).toBe("2026-09-21");
    expect(addWeeks("2026-09-14", -1)).toBe("2026-09-07");
  });
});
