import type { Metadata } from "next";
import Link from "next/link";

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
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, categories(name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const open = tasks?.filter((t) => t.status !== "completed" && t.status !== "cancelled") ?? [];
  const closed = tasks?.filter((t) => t.status === "completed" || t.status === "cancelled") ?? [];

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Заявки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CreateTaskForm projectId={projectId} />

          <div className="flex flex-col divide-y divide-border">
            {open.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Пока нет ни одной заявки.</p>
            ) : (
              open.map((task) => (
                <Link
                  key={task.id}
                  href={`/${projectId}/tasks/${task.id}`}
                  className="flex items-center justify-between gap-2 py-2 hover:bg-muted"
                >
                  <span>{task.title}</span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {task.categories ? <span>{task.categories.name}</span> : null}
                    <span>{taskStatusLabel(task.status)}</span>
                  </span>
                </Link>
              ))
            )}
          </div>

          {closed.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Завершённые и отменённые ({closed.length})
              </summary>
              <div className="flex flex-col divide-y divide-border pt-2">
                {closed.map((task) => (
                  <Link
                    key={task.id}
                    href={`/${projectId}/tasks/${task.id}`}
                    className="flex items-center justify-between gap-2 py-2 hover:bg-muted"
                  >
                    <span className="text-muted-foreground line-through">{task.title}</span>
                    <span className="text-sm text-muted-foreground">
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
