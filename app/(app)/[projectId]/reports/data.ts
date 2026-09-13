import { todayInTimezone } from "@/lib/business/dates";
import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  filterGroups,
  groupByCategory,
  monthStart,
  resolveMonth,
  type ConsumptionGroup,
  type ConsumptionRow,
} from "@/lib/business/material-report";
import { createClient } from "@/lib/supabase/server";

// Общая загрузка отчёта для страницы и CSV-выгрузки — чтобы файл всегда
// совпадал с тем, что мастер видит на экране. Только для серверного кода.

const CATEGORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveCategoryFilter(value: unknown): string {
  if (value === NO_CATEGORY) return NO_CATEGORY;
  if (typeof value === "string" && CATEGORY_ID_RE.test(value)) return value;
  return ALL_CATEGORIES;
}

export type ConsumptionReport =
  | { ok: true; month: string; today: string; groups: ConsumptionGroup[] }
  | { ok: false; month: string; today: string };

export async function loadConsumptionReport(
  projectId: string,
  monthParam: unknown,
  category: string,
): Promise<ConsumptionReport> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("timezone")
    .eq("id", projectId)
    .maybeSingle();

  const today = todayInTimezone(project?.timezone ?? "Europe/Moscow");
  const month = resolveMonth(monthParam, today);

  const { data, error } = await supabase.rpc("material_consumption_by_category", {
    p_project_id: projectId,
    p_month: monthStart(month),
  });

  if (error) {
    console.error("loadConsumptionReport:", error);
    return { ok: false, month, today };
  }

  // Сгенерированные типы не знают, что категория nullable (left join в RPC).
  const rows = (data ?? []) as ConsumptionRow[];
  return { ok: true, month, today, groups: filterGroups(groupByCategory(rows), category) };
}
