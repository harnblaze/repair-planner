import { todayInTimezone } from "@/lib/business/dates";
import {
  resolvePeriod,
  toPeriodRow,
  type PeriodDbRow,
  type PeriodRow,
} from "@/lib/business/materials-period";
import { createClient } from "@/lib/supabase/server";

// Загрузка отчёта «Движение материалов за период» — общая для страницы и
// CSV-выгрузки, чтобы файл всегда совпадал с экраном. Только серверный код.

export type MaterialPeriodReport = {
  ok: boolean;
  from: string;
  to: string;
  /** Сегодня в timezone проекта — для подписи и пресетов. */
  today: string;
  timezone: string;
  /** Параметры периода не разобрались — экран скажет об этом. */
  invalid: boolean;
  rows: PeriodRow[];
};

export async function loadMaterialPeriodReport(
  projectId: string,
  fromParam: unknown,
  toParam: unknown,
): Promise<MaterialPeriodReport> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("timezone")
    .eq("id", projectId)
    .maybeSingle();

  const timezone = project?.timezone ?? "Europe/Moscow";
  const today = todayInTimezone(timezone);
  const period = resolvePeriod(fromParam, toParam, today);

  const { data, error } = await supabase.rpc("material_movements_by_period", {
    p_project_id: projectId,
    p_from: period.from,
    p_to: period.to,
  });

  if (error) {
    console.error("loadMaterialPeriodReport:", error);
    return { ok: false, ...period, today, timezone, rows: [] };
  }

  // Сгенерированные типы знают функцию, но числовые поля приходят строками.
  const rows = ((data ?? []) as PeriodDbRow[]).map(toPeriodRow);
  return { ok: true, ...period, today, timezone, rows };
}
