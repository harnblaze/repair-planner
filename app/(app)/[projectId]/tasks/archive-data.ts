import type { TaskStatus } from "@/lib/business/task-status";
import { createClient } from "@/lib/supabase/server";
import { ARCHIVE_PAGE_SIZE, type ArchiveFilters } from "@/lib/validation/archive-filters";

// Загрузка вкладки «Архив» (public.search_archive_tasks, 0020; дата отмены — 0023; материал — 0024). Только для серверного кода.

export type ArchiveTask = {
  id: string;
  title: string;
  status: TaskStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Расход материала из фильтра; null — фильтра по материалу нет. */
  materialQuantity: number | null;
  categoryName: string | null;
  executorNames: string[];
};

export type ArchiveResult = { ok: true; tasks: ArchiveTask[]; hasMore: boolean } | { ok: false };

export async function loadArchive(projectId: string, filters: ArchiveFilters): Promise<ArchiveResult> {
  const supabase = await createClient();
  const limit = filters.page * ARCHIVE_PAGE_SIZE;

  // На строку больше, чем показываем, — так видно, есть ли продолжение.
  const { data, error } = await supabase.rpc("search_archive_tasks", {
    p_project_id: projectId,
    p_status: filters.status,
    p_query: filters.q || undefined,
    p_category_id: filters.category ?? undefined,
    p_executor_id: filters.executor ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_limit: limit + 1,
    p_material_id: filters.material ?? undefined,
  });

  if (error) {
    console.error("loadArchive:", error);
    return { ok: false };
  }

  const rows = data ?? [];
  return {
    ok: true,
    hasMore: rows.length > limit,
    tasks: rows.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      // Сгенерированные типы не знают, что эти колонки nullable (left join, отменённые).
      completedAt: (r.completed_at as string | null) ?? null,
      cancelledAt: (r.cancelled_at as string | null) ?? null,
      materialQuantity: (r.material_quantity as number | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      executorNames: r.executor_names ?? [],
    })),
  };
}
