import { ATTACHMENTS_BUCKET } from "@/lib/business/attachments";
import type { createClient } from "@/lib/supabase/server";

// Только сервер: удаление файлов-«сирот» проекта в bucket task-attachments
// (docs/superpowers/specs/2026-10-08-attachment-orphan-cleanup-design.md).
// Поиск — RPC task_attachment_orphans (0026), удаление — Storage API сессией
// пользователя под RLS. Работает в фоне после загрузки фото: ошибки только
// логируются, функция не бросает.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Удаляет найденные «сироты» проекта; возвращает число удалённых файлов. */
export async function cleanupAttachmentOrphans(supabase: Supabase, projectId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("task_attachment_orphans", { p_project_id: projectId });
    if (error) {
      console.error("cleanupAttachmentOrphans (rpc):", error);
      return 0;
    }

    const paths = data ?? [];
    if (paths.length === 0) return 0;

    const { error: removeError } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
    if (removeError) {
      console.error("cleanupAttachmentOrphans (storage):", removeError);
      return 0;
    }

    return paths.length;
  } catch (error) {
    console.error("cleanupAttachmentOrphans:", error);
    return 0;
  }
}
