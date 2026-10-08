// Месячный отчёт по расходу материалов в разрезе цехов-заказчиков
// (docs/product-requirements.md §4.6). Агрегация — в БД
// (public.material_consumption_by_category), здесь только месяц, группировка,
// фильтр и форматирование для экрана и CSV.
// Месяц — строка "YYYY-MM"; "сегодня" берётся в timezone проекта (dates.ts).

import { buildCsv, csvNumber, csvText } from "./csv";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTHS_RU_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** Месяц из query-параметра или месяц «сегодня» (today — "YYYY-MM-DD" в timezone проекта). */
export function resolveMonth(value: unknown, today: string): string {
  return isMonth(value) ? value : today.slice(0, 7);
}

/** Первое число месяца — аргумент p_month для RPC. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

export function addMonths(month: string, months: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "Сентябрь 2026" */
export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTHS_RU_NOMINATIVE[m - 1]} ${year}`;
}

/** Значение фильтра: все цеха, заявки без цеха или id категории. */
export const ALL_CATEGORIES = "all";
export const NO_CATEGORY = "none";

export type ConsumptionRow = {
  category_id: string | null;
  category_name: string | null;
  material_id: string;
  material_name: string;
  unit: string;
  quantity: number;
};

export type ConsumptionGroup = {
  categoryId: string | null;
  categoryName: string;
  items: { materialId: string; materialName: string; unit: string; quantity: number }[];
};

export const NO_CATEGORY_LABEL = "Без цеха";

/** Строки RPC уже упорядочены по цеху и материалу — порядок сохраняется. */
export function groupByCategory(rows: ConsumptionRow[]): ConsumptionGroup[] {
  const groups = new Map<string, ConsumptionGroup>();

  for (const row of rows) {
    const key = row.category_id ?? NO_CATEGORY;
    let group = groups.get(key);
    if (!group) {
      group = {
        categoryId: row.category_id,
        categoryName: row.category_name ?? NO_CATEGORY_LABEL,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push({
      materialId: row.material_id,
      materialName: row.material_name,
      unit: row.unit,
      quantity: Number(row.quantity),
    });
  }

  return [...groups.values()];
}

export function filterGroups(groups: ConsumptionGroup[], category: string): ConsumptionGroup[] {
  if (category === ALL_CATEGORIES) return groups;
  if (category === NO_CATEGORY) return groups.filter((g) => g.categoryId === null);
  return groups.filter((g) => g.categoryId === category);
}

/** Query-строка отчёта по расходу: month и цех (кроме «все»). */
export function consumptionReportQuery(month: string, category: string): string {
  const params = new URLSearchParams({ month });
  if (category !== ALL_CATEGORIES) params.set("category", category);
  return params.toString();
}

const QUANTITY_FORMAT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

/** "1 234,5" — для экрана. */
export function formatQuantity(quantity: number): string {
  return QUANTITY_FORMAT.format(quantity);
}

/** CSV отчёта по расходу (формат — lib/business/csv.ts). */
export function buildConsumptionCsv(groups: ConsumptionGroup[]): string {
  const lines = [["Цех", "Материал", "Ед. изм.", "Расход"]];

  for (const group of groups) {
    for (const item of group.items) {
      lines.push([csvText(group.categoryName), csvText(item.materialName), csvText(item.unit), csvNumber(item.quantity)]);
    }
  }

  return buildCsv(lines);
}
