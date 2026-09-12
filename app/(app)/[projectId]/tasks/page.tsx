import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { taskStatusLabel } from "@/lib/business/task-status";
import { createClient } from "@/lib/supabase/server";

import { CreateTaskForm } from "./create-task-form";

export const metadata: Metadata = {
  title: "Заявки — Repair Planner",
};

export default async function TasksPage({ params }: PageProps<"/[projectId]/tasks">) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: tasks }, { data: categories }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, categories(name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),
  ]);

  const open = tasks?.filter((t) => t.status !== "completed" && t.status !== "cancelled") ?? [];
  const closed = tasks?.filter((t) => t.status === "completed" || t.status === "cancelled") ?? [];

  return (
    <main className="mx-auto flex max-w-lg w-full flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Заявки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateTaskForm projectId={projectId} categories={categories ?? []} />

          <div className="flex flex-col divide-y divide-line-subtle">
            {open.length === 0 ? (
              <EmptyState>Пока нет ни одной заявки.</EmptyState>
            ) : (
              open.map((task) => (
                <Link
                  key={task.id}
                  href={`/${projectId}/tasks/${task.id}`}
                  className="flex items-center justify-between gap-2 py-2 hover:bg-row-hover"
                >
                  <span>{task.title}</span>
                  <span className="flex items-center gap-2 text-[12px] text-meta">
                    {task.categories ? <span>{task.categories.name}</span> : null}
                    <span>{taskStatusLabel(task.status)}</span>
                  </span>
                </Link>
              ))
            )}
          </div>

          {closed.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-[12px] text-meta">
                Завершённые и отменённые ({closed.length})
              </summary>
              <div className="flex flex-col divide-y divide-line-subtle pt-2">
                {closed.map((task) => (
                  <Link
                    key={task.id}
                    href={`/${projectId}/tasks/${task.id}`}
                    className="flex items-center justify-between gap-2 py-2 hover:bg-row-hover"
                  >
                    <span className="text-meta line-through">{task.title}</span>
                    <span className="text-[12px] text-meta">
                      {taskStatusLabel(task.status)}
                    </span>
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
