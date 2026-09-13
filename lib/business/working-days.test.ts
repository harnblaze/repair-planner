import { describe, expect, it } from "vitest";

import {
  addWeeks,
  buildWorkCalendar,
  calendarDayKindFor,
  isValidDateString,
  isWorkingDay,
  mondayOf,
  nextWorkingDay,
  weekBoardDays,
  weekdayLabel,
} from "./working-days";

const NO_EXCEPTIONS = buildWorkCalendar([]);

// 2026-09-14 — понедельник.
const calendar = buildWorkCalendar([
  { day: "2026-09-16", kind: "holiday", name: "Праздник" }, // Ср
  { day: "2026-09-18", kind: "holiday", name: null }, // Пт
  { day: "2026-09-19", kind: "working_day", name: "Перенос" }, // Сб
  { day: "2026-09-21", kind: "holiday", name: null }, // Пн
]);

describe("isWorkingDay", () => {
  it("без исключений считает Пн–Пт рабочими, Сб и Вс — выходными", () => {
    expect(isWorkingDay("2026-09-14", NO_EXCEPTIONS)).toBe(true); // Пн
    expect(isWorkingDay("2026-09-18", NO_EXCEPTIONS)).toBe(true); // Пт
    expect(isWorkingDay("2026-09-19", NO_EXCEPTIONS)).toBe(false); // Сб
    expect(isWorkingDay("2026-09-20", NO_EXCEPTIONS)).toBe(false); // Вс
  });

  it("учитывает нерабочие будни и рабочие субботы календаря", () => {
    expect(isWorkingDay("2026-09-16", calendar)).toBe(false);
    expect(isWorkingDay("2026-09-19", calendar)).toBe(true);
    expect(isWorkingDay("2026-09-17", calendar)).toBe(true);
  });
});

describe("nextWorkingDay", () => {
  it("для будних дней (кроме пятницы) возвращает следующий календарный день", () => {
    expect(nextWorkingDay("2026-09-14", NO_EXCEPTIONS)).toBe("2026-09-15"); // Пн → Вт
    expect(nextWorkingDay("2026-09-17", NO_EXCEPTIONS)).toBe("2026-09-18"); // Чт → Пт
  });

  it("пятница, суббота и воскресенье → понедельник", () => {
    expect(nextWorkingDay("2026-09-18", NO_EXCEPTIONS)).toBe("2026-09-21");
    expect(nextWorkingDay("2026-09-19", NO_EXCEPTIONS)).toBe("2026-09-21");
    expect(nextWorkingDay("2026-09-20", NO_EXCEPTIONS)).toBe("2026-09-21");
  });

  it("пропускает нерабочий будний день", () => {
    expect(nextWorkingDay("2026-09-15", calendar)).toBe("2026-09-17"); // Вт → Чт, Ср — праздник
  });

  it("переносит на рабочую субботу", () => {
    expect(nextWorkingDay("2026-09-17", calendar)).toBe("2026-09-19"); // Чт → Сб, Пт — праздник
  });

  it("пропускает воскресенье и праздничный понедельник", () => {
    expect(nextWorkingDay("2026-09-19", calendar)).toBe("2026-09-22"); // Сб → Вт
  });

  it("не заходит в бесконечный поиск", () => {
    const allHolidays = buildWorkCalendar(
      Array.from({ length: 400 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10);
        return { day: date, kind: "holiday" as const, name: null };
      }),
    );
    expect(() => nextWorkingDay("2026-09-14", allHolidays)).toThrow();
  });
});

describe("calendarDayKindFor", () => {
  it("будний день может быть только нерабочим, суббота — только рабочей", () => {
    expect(calendarDayKindFor("2026-09-14")).toBe("holiday");
    expect(calendarDayKindFor("2026-09-18")).toBe("holiday");
    expect(calendarDayKindFor("2026-09-19")).toBe("working_day");
  });

  it("воскресенье исключением не бывает", () => {
    expect(calendarDayKindFor("2026-09-20")).toBeNull();
  });
});

describe("isValidDateString", () => {
  it("принимает существующую дату и отклоняет несуществующую или в другом формате", () => {
    expect(isValidDateString("2026-09-14")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("14.09.2026")).toBe(false);
  });
});

describe("weekdayLabel", () => {
  it("возвращает короткое название дня недели", () => {
    expect(weekdayLabel("2026-09-14")).toBe("Пн");
    expect(weekdayLabel("2026-09-19")).toBe("Сб");
    expect(weekdayLabel("2026-09-20")).toBe("Вс");
  });
});

describe("mondayOf", () => {
  it("для любого дня недели возвращает её понедельник", () => {
    expect(mondayOf("2026-09-14")).toBe("2026-09-14"); // сам понедельник
    expect(mondayOf("2026-09-18")).toBe("2026-09-14"); // пятница той же недели
    expect(mondayOf("2026-09-20")).toBe("2026-09-14"); // воскресенье той же недели
  });
});

describe("weekBoardDays", () => {
  const monToFri = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];

  it("без рабочей субботы — Пн–Пт, включая нерабочие будни", () => {
    expect(weekBoardDays("2026-09-14", NO_EXCEPTIONS)).toEqual(monToFri);
  });

  it("добавляет рабочую субботу", () => {
    expect(weekBoardDays("2026-09-14", calendar)).toEqual([...monToFri, "2026-09-19"]);
  });

  it("добавляет субботу, если на неё уже есть задачи", () => {
    expect(weekBoardDays("2026-09-14", NO_EXCEPTIONS, true)).toEqual([...monToFri, "2026-09-19"]);
  });
});

describe("addWeeks", () => {
  it("сдвигает понедельник на N недель вперёд/назад", () => {
    expect(addWeeks("2026-09-14", 1)).toBe("2026-09-21");
    expect(addWeeks("2026-09-14", -1)).toBe("2026-09-07");
  });
});
