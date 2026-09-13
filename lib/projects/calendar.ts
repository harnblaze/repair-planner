import { buildWorkCalendar, type WorkCalendar } from "@/lib/business/working-days";
import { createClient } from "@/lib/supabase/server";

/**
 * Исключения календаря проекта в диапазоне дат (включительно).
 * null — запрос не удался: вызывающий решает, можно ли продолжить без календаря.
 */
export async function getWorkCalendar(
  projectId: string,
  from: string,
  to: string,
): Promise<WorkCalendar | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_calendar_days")
    .select("day, kind, name")
    .eq("project_id", projectId)
    .gte("day", from)
    .lte("day", to);

  if (error) {
    console.error("getWorkCalendar:", error);
    return null;
  }
  return buildWorkCalendar(data);
}
