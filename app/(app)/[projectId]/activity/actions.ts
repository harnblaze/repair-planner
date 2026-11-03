"use server";

import { countSince, parseSeenAt } from "@/lib/business/activity-seen";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Сколько записей ленты появилось после метки «прочитано».
 *
 * Считаем в базе, а не по загруженной странице: лента открывается порциями по
 * 30, и по ним число новых молча занижалось бы. Глубже 30 дней не смотрим —
 * старая история не должна светиться в навигации вечно.
 *
 * Свои действия новыми не считаем: мастер не должен видеть бейдж от того, что
 * сам создал заявку минуту назад. Записи импорта (actor_id is null) считаются
 * новыми — их сделал не он.
 */
export async function countNewActivityAction(
  projectId: string,
  since: string | null,
): Promise<number> {
  const role = await getProjectRole(projectId);
  if (!role) return 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const from = countSince(parseSeenAt(since), new Date());

  let query = supabase
    .from("project_activity")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .gt("created_at", from);

  // NULL <> auth.uid() в SQL даёт NULL, поэтому записи импорта перечисляем
  // явно — иначе они бы выпали из подсчёта.
  if (user) {
    query = query.or(`actor_id.is.null,actor_id.neq.${user.id}`);
  }

  const { count, error } = await query;

  if (error) {
    console.error("countNewActivityAction:", error);
    return 0;
  }

  return count ?? 0;
}
