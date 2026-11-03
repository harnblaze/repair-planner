// Отчёт «Движение материалов за период»: приход, расход, остаток на конец и
// последнее движение. Агрегация — в БД (public.material_movements_by_period,
// 0041), здесь только период (разбор, пресеты, подписи), сводка и CSV.
//
// Даты — строки "YYYY-MM-DD" в timezone проекта: «сегодня» приходит уже
// посчитанным в этой зоне (dates.ts), а арифметика ведётся в UTC, чтобы
// переходы на летнее время не сдвигали день.

import { buildCsv, csvNumber, csvText } from "./csv";
import { formatDateNumeric } from "./dates";
import { addMonths } from "./material-report";

/** Значение параметра report для вкладки «Движение за период». */
export const PERIOD_REPORT = "period";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS_RU_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export type Period = { from: string; to: string };

export type PeriodPreset = "this-month" | "last-month" | "three-months";

/** Строка RPC в том виде, в каком её отдаёт Postgres. */
export type PeriodDbRow = {
  material_id: string;
  name: string;
  unit: string;
  receipt: number | string;
  consumption: number | string;
  adjustment: number | string;
  balance_at_end: number | string;
  last_moved_at: string | null;
};

export type PeriodRow = {
  materialId: string;
  name: string;
  unit: string;
  receipt: number;
  consumption: number;
  adjustment: number;
  balanceAtEnd: number;
  lastMovedAt: string | null;
};

export type PeriodSummary = {
  moved: number;
  /** Сколько материалов в периоде не двигалось. */
  still: number;
  consumption: number;
  receipt: number;
};

function splitIso(date: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_RE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Проверяем, что такой день в этом месяце существует: 2026-02-30 — не дата.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function toIso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const parts = splitIso(date);
  if (!parts) return date;
  return toIso(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)));
}

/** Последнее число месяца "YYYY-MM". */
function monthEnd(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return toIso(new Date(Date.UTC(year, m, 0)));
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && splitIso(value) !== null;
}

/** Период по умолчанию: с 1-го числа текущего месяца по сегодня. */
export function defaultPeriod(today: string): Period {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const month = today.slice(0, 7);
  switch (preset) {
    case "last-month": {
      const previous = addMonths(month, -1);
      return { from: `${previous}-01`, to: monthEnd(previous) };
    }
    case "three-months":
      // Три календарных месяца, включая текущий: с 1-го числа два месяца назад.
      return { from: `${addMonths(month, -2)}-01`, to: today };
    default:
      return defaultPeriod(today);
  }
}

/**
 * Период из query-параметров. Если даты не разобрались или начало позже конца —
 * откатываемся на период по умолчанию и говорим об этом экрану флагом invalid.
 */
export function resolvePeriod(fromParam: unknown, toParam: unknown, today: string): Period & { invalid: boolean } {
  const fallback = defaultPeriod(today);
  if (!isIsoDate(fromParam) || !isIsoDate(toParam) || fromParam > toParam) {
    return { ...fallback, invalid: true };
  }
  return { from: fromParam, to: toParam, invalid: false };
}

/** Какой пресет соответствует периоду (для подсветки кнопки) или null. */
export function matchPreset(period: Period, today: string): PeriodPreset | null {
  const presets: PeriodPreset[] = ["this-month", "last-month", "three-months"];
  for (const preset of presets) {
    const candidate = presetPeriod(preset, today);
    if (candidate.from === period.from && candidate.to === period.to) return preset;
  }
  return null;
}

/** Query-строка отчёта: вкладка, начало и конец периода. */
export function periodQuery(from: string, to: string): string {
  return new URLSearchParams({ report: PERIOD_REPORT, from, to }).toString();
}

/** "1–31 октября 2026" или "1 сентября — 3 ноября 2026". */
export function formatPeriodLabel(from: string, to: string): string {
  const a = splitIso(from);
  const b = splitIso(to);
  if (!a || !b) return `${from} — ${to}`;
  if (a.year === b.year && a.month === b.month) {
    return `${a.day}–${b.day} ${MONTHS_RU_GENITIVE[b.month - 1]} ${b.year}`;
  }
  if (a.year === b.year) {
    return `${a.day} ${MONTHS_RU_GENITIVE[a.month - 1]} — ${b.day} ${MONTHS_RU_GENITIVE[b.month - 1]} ${b.year}`;
  }
  return `${a.day} ${MONTHS_RU_GENITIVE[a.month - 1]} ${a.year} — ${b.day} ${MONTHS_RU_GENITIVE[b.month - 1]} ${b.year}`;
}

export function toPeriodRow(row: PeriodDbRow): PeriodRow {
  return {
    materialId: row.material_id,
    name: row.name,
    unit: row.unit,
    receipt: Number(row.receipt),
    consumption: Number(row.consumption),
    adjustment: Number(row.adjustment),
    balanceAtEnd: Number(row.balance_at_end),
    lastMovedAt: row.last_moved_at,
  };
}

/** Двигался ли материал в периоде хоть раз. */
export function isMoved(row: PeriodRow): boolean {
  return row.receipt !== 0 || row.consumption !== 0 || row.adjustment !== 0;
}

/** Порядок как в RPC: расход по убыванию, затем название. */
export function sortPeriodRows(rows: PeriodRow[]): PeriodRow[] {
  return [...rows].sort((a, b) => {
    if (b.consumption !== a.consumption) return b.consumption - a.consumption;
    return a.name.localeCompare(b.name, "ru");
  });
}

export function summarizePeriod(rows: PeriodRow[]): PeriodSummary {
  let moved = 0;
  let consumption = 0;
  let receipt = 0;
  for (const row of rows) {
    if (isMoved(row)) moved += 1;
    consumption += row.consumption;
    receipt += row.receipt;
  }
  return { moved, still: rows.length - moved, consumption, receipt };
}

/** CSV отчёта (формат — lib/business/csv.ts), строки те же, что на экране. */
export function buildPeriodCsv(rows: PeriodRow[], timezone: string): string {
  const lines = [
    ["Материал", "Ед. изм.", "Приход", "Расход", "Корректировка", "Остаток на конец", "Последнее движение"],
  ];

  for (const row of rows) {
    lines.push([
      csvText(row.name),
      csvText(row.unit),
      csvNumber(row.receipt),
      csvNumber(row.consumption),
      csvNumber(row.adjustment),
      csvNumber(row.balanceAtEnd),
      row.lastMovedAt ? formatDateNumeric(row.lastMovedAt, timezone) : "",
    ]);
  }

  return buildCsv(lines);
}

/** Последнее движение для экрана: "31.10.2026" или «—». */
export function formatLastMoved(row: PeriodRow, timezone: string): string {
  return row.lastMovedAt ? formatDateNumeric(row.lastMovedAt, timezone) : "—";
}

export { addDays };
