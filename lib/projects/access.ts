import { cache } from "react";

import { canEditProject, type ProjectRole } from "@/lib/business/project-roles";
import { consumeRateLimit } from "@/lib/business/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";

/** Не чаще одной записи в минуту на пару «пользователь + проект». */
const ACCESS_DENIED_LOG_WINDOW_MS = 60_000;

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

  if (data) return data;

  // Отказ в доступе раньше не оставлял следа, и перебор чужих projectId был
  // неотличим от обычной работы. Пишем одну строку — без токенов, email и
  // прочих данных: id человека и id проекта достаточно, чтобы разобраться.
  //
  // Лишний getUser() только здесь, на отказе: у законного участника запроса
  // не добавляется. Без сессии не логируем — это не перебор, а гость.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const key = `access-denied:${user.id}:${projectId}`;
    if (consumeRateLimit(key, 1, ACCESS_DENIED_LOG_WINDOW_MS).ok) {
      console.warn("access denied", { projectId, userId: user.id });
    }
  }

  return null;
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
