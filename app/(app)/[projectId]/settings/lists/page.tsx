import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import { CreateListForm } from "./create-list-form";
import { ListRow, type ListRowData } from "./list-row";

export const metadata: Metadata = {
  title: "Дополнительные списки — Repair Planner",
};

export default async function BoardListsPage({ params }: PageProps<"/[projectId]/settings/lists">) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [role, { data, error }] = await Promise.all([
    getProjectRole(projectId),
    supabase
      .from("board_lists")
      .select("id, name, is_system, board_items(count)")
      .eq("project_id", projectId)
      // Тот же порядок, что на доске.
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (error) console.error("BoardListsPage:", error);

  const lists: ListRowData[] = (data ?? []).map((list) => ({
    id: list.id,
    name: list.name,
    isSystem: list.is_system,
    itemCount: list.board_items[0]?.count ?? 0,
  }));
  const canEdit = canEditProject(role);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-6 pb-7">
      <Link href={`/${projectId}/settings`} className="self-start text-[12.5px] text-meta hover:text-ink">
        ← Настройки проекта
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Дополнительные списки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12.5px] text-ink-muted">
            Списки показываются на доске после «Текущих заявок» в этом порядке. Стандартные списки
            можно переименовать, но не удалить. При удалении своего списка удаляются и его записи.
          </p>

          {canEdit ? <CreateListForm projectId={projectId} /> : null}

          <div className="flex flex-col divide-y divide-line-subtle">
            {error ? (
              <EmptyState>Не удалось загрузить списки. Обновите страницу.</EmptyState>
            ) : lists.length === 0 ? (
              <EmptyState>Списков пока нет.</EmptyState>
            ) : (
              lists.map((list, index) => (
                <ListRow
                  key={list.id}
                  projectId={projectId}
                  list={list}
                  index={index}
                  total={lists.length}
                  canEdit={canEdit}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
