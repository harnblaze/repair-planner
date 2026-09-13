// Рабочие дни доски (CLAUDE.md §26). Базовое правило: Пн–Пт — рабочие, Сб и Вс —
// выходные. Календарь проекта (project_calendar_days) хранит только исключения:
// нерабочие будни (праздники, перенесённые выходные) и рабочие субботы.
//
// Вся арифметика — в UTC поверх календарной даты "YYYY-MM-DD", без привязки к
// локальному часовому поясу среды выполнения: у даты без времени суток нет
// собственного timezone, и подмешивать сюда local time сервера/браузера —
// источник ошибок на смене дня/недели (CLAUDE.md §32).
// Логика синхронизирована с private.is_working_day / private.next_working_day
// в supabase/migrations/0013 — БД остаётся источником истины.

export type CalendarDayKind = "holiday" | "working_day";

export type CalendarDay = { day: string; kind: CalendarDayKind; name: string | null };

/** Исключения из правила Пн–Пт по дате "YYYY-MM-DD". */
export type WorkCalendar = ReadonlyMap<string, CalendarDay>;

export function buildWorkCalendar(days: readonly CalendarDay[]): WorkCalendar {
  return new Map(days.map((d) => [d.day, d]));
}

const WEEKDAY_LABELS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

// Горизонт поиска следующего рабочего дня — как в private.next_working_day.
const SEARCH_HORIZON_DAYS = 366;

function parseDateUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateUTC(date);
}

/** 0 = воскресенье … 6 = суббота (как Date.getUTCDay). */
function weekday(dateStr: string): number {
  return parseDateUTC(dateStr).getUTCDay();
}

/** Существующая календарная дата "YYYY-MM-DD" (не 2026-02-30). */
export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && formatDateUTC(parseDateUTC(value)) === value;
}

/** «Пн» … «Вс». */
export function weekdayLabel(dateStr: string): string {
  return WEEKDAY_LABELS_RU[weekday(dateStr)];
}

export function isWorkingDay(dateStr: string, calendar: WorkCalendar): boolean {
  const exception = calendar.get(dateStr);
  if (exception) return exception.kind === "working_day";
  const day = weekday(dateStr);
  return day >= 1 && day <= 5;
}

/**
 * Каким исключением может быть дата: будний день — только нерабочим,
 * суббота — только рабочей. Воскресенье исключением не бывает (null).
 */
export function calendarDayKindFor(dateStr: string): CalendarDayKind | null {
  const day = weekday(dateStr);
  if (day >= 1 && day <= 5) return "holiday";
  if (day === 6) return "working_day";
  return null;
}

/**
 * Следующий рабочий день после dateStr с учётом календаря.
 * Календарь должен покрывать даты, в которых идёт поиск; исключения вне
 * переданного диапазона считаются отсутствующими.
 */
export function nextWorkingDay(dateStr: string, calendar: WorkCalendar): string {
  let day = dateStr;
  for (let i = 0; i < SEARCH_HORIZON_DAYS; i++) {
    day = addDays(day, 1);
    if (isWorkingDay(day, calendar)) return day;
  }
  throw new Error(`No working day within ${SEARCH_HORIZON_DAYS} days after ${dateStr}`);
}

/** Понедельник недели, которой принадлежит указанная дата. */
export function mondayOf(dateStr: string): string {
  const day = weekday(dateStr);
  const isoDay = day === 0 ? 7 : day; // 1..7, Пн..Вс
  return addDays(dateStr, 1 - isoDay);
}

/** Суббота недели, начинающейся с mondayDateStr, — последний день, который может быть на доске. */
export function saturdayOf(mondayDateStr: string): string {
  return addDays(mondayDateStr, 5);
}

/**
 * Колонки недели на доске: Пн–Пт всегда (нерабочие будни показываются
 * отмеченными), суббота — если она рабочая или на неё уже есть задачи
 * (например, рабочую субботу убрали из календаря после планирования).
 */
export function weekBoardDays(
  mondayDateStr: string,
  calendar: WorkCalendar,
  hasTasksOnSaturday = false,
): string[] {
  const days = [0, 1, 2, 3, 4].map((offset) => addDays(mondayDateStr, offset));
  const saturday = saturdayOf(mondayDateStr);
  if (hasTasksOnSaturday || isWorkingDay(saturday, calendar)) days.push(saturday);
  return days;
}

export function addWeeks(mondayDateStr: string, weeks: number): string {
  return addDays(mondayDateStr, weeks * 7);
}
