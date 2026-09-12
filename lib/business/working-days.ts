// Рабочие дни доски: понедельник–пятница (CLAUDE.md §26). Вся арифметика — в UTC
// поверх календарной даты "YYYY-MM-DD", без привязки к локальному часовому поясу
// среды выполнения: у даты без времени суток нет собственного timezone, и подмешивать
// сюда local time сервера/браузера — источник ошибок на смене дня/недели (CLAUDE.md §32).
// Логика синхронизирована с public.next_working_day() в supabase/migrations/0006.

export const WEEKDAY_LABELS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт"] as const;

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

function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateUTC(date);
}

/** 0 = воскресенье … 6 = суббота (как Date.getUTCDay). */
function weekday(dateStr: string): number {
  return parseDateUTC(dateStr).getUTCDay();
}

export function isWorkingDay(dateStr: string): boolean {
  const day = weekday(dateStr);
  return day >= 1 && day <= 5;
}

/** Следующий рабочий день: пятница → понедельник, суббота → понедельник, иначе +1. */
export function nextWorkingDay(dateStr: string): string {
  const day = weekday(dateStr);
  if (day === 5) return addDays(dateStr, 3);
  if (day === 6) return addDays(dateStr, 2);
  return addDays(dateStr, 1);
}

/** Понедельник недели, которой принадлежит указанная дата. */
export function mondayOf(dateStr: string): string {
  const day = weekday(dateStr);
  const isoDay = day === 0 ? 7 : day; // 1..7, Пн..Вс
  return addDays(dateStr, 1 - isoDay);
}

/** Пн–Пт недели, начинающейся с mondayDateStr. */
export function weekWorkingDays(mondayDateStr: string): string[] {
  return [0, 1, 2, 3, 4].map((offset) => addDays(mondayDateStr, offset));
}

export function addWeeks(mondayDateStr: string, weeks: number): string {
  return addDays(mondayDateStr, weeks * 7);
}
