import { cache } from "react";

import { canEditProject, type ProjectRole } from "@/lib/business/project-roles";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";

/**
 * Роль текущего пользователя в проекте или null, если доступа нет.
 * cache() — один запрос на рендер для layout и страниц.
 */
export const getProjectRole = cache(async (projectId: string): Promise<ProjectRole | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_access", { p_project_id: projectId });

  if (error) {
    console.error("getProjectRole:", error);
    return null;
  }
  return data ?? null;
});

export const NO_EDIT_ACCESS_MESSAGE = "Недостаточно прав для изменения данных проекта.";

/**
 * Проверка в начале изменяющего действия. Гарантию даёт RLS; проверка нужна,
 * чтобы UPDATE/DELETE, отфильтрованный политикой до 0 строк, не выглядел
 * успешным (например, роль сменили, пока страница была открыта).
 */
export async function requireProjectEdit(projectId: string): Promise<ActionResult | null> {
  const role = await getProjectRole(projectId);
  return canEditProject(role) ? null : { ok: false, error: NO_EDIT_ACCESS_MESSAGE };
}
