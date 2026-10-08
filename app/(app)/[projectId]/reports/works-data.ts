import { todayInTimezone } from "@/lib/business/dates";
import { monthStart, resolveMonth } from "@/lib/business/material-report";
import { filterWorkGroups, groupWorksByCategory, type WorkGroup, type WorkRow } from "@/lib/business/works-report";
import { createClient } from "@/lib/supabase/server";

// Общая загрузка отчёта «Выполненные работы» для страницы и CSV — файл всегда
// совпадает с экраном. Только для серверного кода.

export type WorksReport =
  | { ok: true; month: string; today: string; timezone: string; groups: WorkGroup[] }
  | { ok: false; month: string; today: string; timezone: string };

export async function loadWorksReport(projectId: string, monthParam: unknown, category: string): Promise<WorksReport> {
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle();

  const timezone = project?.timezone ?? "Europe/Moscow";
  const today = todayInTimezone(timezone);
  const month = resolveMonth(monthParam, today);

  const { data, error } = await supabase.rpc("completed_works_report", {
    p_project_id: projectId,
    p_month: monthStart(month),
  });

  if (error) {
    console.error("loadWorksReport:", error);
    return { ok: false, month, today, timezone };
  }

  // Сгенерированные типы не знают, что цех nullable (left join) и форму jsonb материалов.
  const rows = (data ?? []) as unknown as WorkRow[];
  return { ok: true, month, today, timezone, groups: filterWorkGroups(groupWorksByCategory(rows), category) };
}
