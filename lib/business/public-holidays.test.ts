import { describe, expect, it } from "vitest";

import { russianPublicHolidays } from "./public-holidays";

describe("russianPublicHolidays", () => {
  it("возвращает только праздники, выпавшие на Пн–Пт", () => {
    // 2026: 3 и 4 января — Сб и Вс, 8 марта — Вс, 9 мая — Сб.
    const { holidays, onWeekendCount } = russianPublicHolidays(2026);

    expect(holidays.map((h) => h.day)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-02-23",
      "2026-05-01",
      "2026-06-12",
      "2026-11-04",
    ]);
    expect(onWeekendCount).toBe(4);
  });

  it("все записи — нерабочие дни с названием", () => {
    const { holidays } = russianPublicHolidays(2027);

    expect(holidays.every((h) => h.kind === "holiday" && h.name)).toBe(true);
    expect(holidays.find((h) => h.day === "2027-01-07")?.name).toBe("Рождество Христово");
  });

  it("вместе с выходными покрывает все 14 праздничных дней", () => {
    for (const year of [2025, 2026, 2027, 2028]) {
      const { holidays, onWeekendCount } = russianPublicHolidays(year);
      expect(holidays.length + onWeekendCount).toBe(14);
    }
  });
});
