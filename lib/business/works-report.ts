// Отчёт «Выполненные работы за месяц» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md).
// Выборка и порядок — в БД (public.completed_works_report, 0025), здесь —
// группировка по цеху, фильтр, форматирование для экрана и CSV.

import { buildCsv, csvText } from "./csv";
import { formatDateNumeric } from "./dates";
import { ALL_CATEGORIES, NO_CATEGORY, NO_CATEGORY_LABEL, formatQuantity } from "./material-report";

/** Значение параметра report вкладки «Выполненные работы» на странице отчётов. */
export const WORKS_REPORT = "works";

export type WorkMaterial = { name: string; unit: string; quantity: number };

export type WorkRow = {
  task_id: string;
  title: string;
  completed_at: string;
  category_id: string | null;
  category_name: string | null;
  category_sort_order: number | null;
  executor_names: string[];
  materials: WorkMaterial[];
};

export type Work = {
  taskId: string;
  title: string;
  completedAt: string;
  executorNames: string[];
  materials: WorkMaterial[];
};

export type WorkGroup = { categoryId: string | null; categoryName: string; works: Work[] };

/** Строки RPC уже упорядочены по цеху и дате — порядок сохраняется. */
export function groupWorksByCategory(rows: WorkRow[]): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();

  for (const row of rows) {
    const key = row.category_id ?? NO_CATEGORY;
    let group = groups.get(key);
    if (!group) {
      group = { categoryId: row.category_id, categoryName: row.category_name ?? NO_CATEGORY_LABEL, works: [] };
      groups.set(key, group);
    }
    group.works.push({
      taskId: row.task_id,
      title: row.title,
      completedAt: row.completed_at,
      executorNames: row.executor_names ?? [],
      materials: (row.materials ?? []).map((m) => ({ name: m.name, unit: m.unit, quantity: Number(m.quantity) })),
    });
  }

  return [...groups.values()];
}

export function filterWorkGroups(groups: WorkGroup[], category: string): WorkGroup[] {
  if (category === ALL_CATEGORIES) return groups;
  if (category === NO_CATEGORY) return groups.filter((g) => g.categoryId === null);
  return groups.filter((g) => g.categoryId === category);
}

/** «Электрод 2,5 кг; Краска 1 л» — для строки отчёта и ячейки CSV. */
export function formatMaterials(materials: WorkMaterial[]): string {
  return materials.map((m) => `${m.name} ${formatQuantity(m.quantity)} ${m.unit}`).join("; ");
}

/** CSV совпадает с экраном, включая фильтр по цеху (формат — csv.ts). */
export function buildWorksCsv(groups: WorkGroup[], timezone: string): string {
  const lines = [["Цех", "Дата выполнения", "Заявка", "Исполнители", "Материалы"]];

  for (const group of groups) {
    for (const work of group.works) {
      lines.push([
        csvText(group.categoryName),
        formatDateNumeric(work.completedAt, timezone),
        csvText(work.title),
        csvText(work.executorNames.join(", ")),
        csvText(formatMaterials(work.materials)),
      ]);
    }
  }

  return buildCsv(lines);
}

/** Query-строка вкладки работ: report, month и цех (кроме «все»). */
export function worksReportQuery(month: string, category: string): string {
  const params = new URLSearchParams({ report: WORKS_REPORT, month });
  if (category !== ALL_CATEGORIES) params.set("category", category);
  return params.toString();
}
