// Нерабочие праздничные дни РФ по ст. 112 Трудового кодекса — фиксированные даты.
// Переносы выходных устанавливаются ежегодно постановлением Правительства и сюда
// не входят: их мастер добавляет в календарь проекта вручную (решение этапа 16,
// docs/product-requirements.md §4.1). Праздник, выпавший на субботу или
// воскресенье, в календарь не записывается — день и так выходной.

import { calendarDayKindFor, type CalendarDay } from "./working-days";

const RU_PUBLIC_HOLIDAYS: readonly { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "Новогодние каникулы" },
  { month: 1, day: 2, name: "Новогодние каникулы" },
  { month: 1, day: 3, name: "Новогодние каникулы" },
  { month: 1, day: 4, name: "Новогодние каникулы" },
  { month: 1, day: 5, name: "Новогодние каникулы" },
  { month: 1, day: 6, name: "Новогодние каникулы" },
  { month: 1, day: 7, name: "Рождество Христово" },
  { month: 1, day: 8, name: "Новогодние каникулы" },
  { month: 2, day: 23, name: "День защитника Отечества" },
  { month: 3, day: 8, name: "Международный женский день" },
  { month: 5, day: 1, name: "Праздник Весны и Труда" },
  { month: 5, day: 9, name: "День Победы" },
  { month: 6, day: 12, name: "День России" },
  { month: 11, day: 4, name: "День народного единства" },
];

export type PublicHolidays = {
  /** Праздники, выпавшие на Пн–Пт, — готовые записи календаря. */
  holidays: CalendarDay[];
  /** Сколько праздников выпало на выходные и не записывается. */
  onWeekendCount: number;
};

export function russianPublicHolidays(year: number): PublicHolidays {
  const holidays: CalendarDay[] = [];
  let onWeekendCount = 0;

  for (const { month, day, name } of RU_PUBLIC_HOLIDAYS) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (calendarDayKindFor(date) === "holiday") {
      holidays.push({ day: date, kind: "holiday", name });
    } else {
      onWeekendCount++;
    }
  }

  return { holidays, onWeekendCount };
}
