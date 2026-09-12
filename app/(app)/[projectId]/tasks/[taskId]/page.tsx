import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ExecutorsPicker } from "./executors-picker";
import { StatusSelect } from "./status-select";
import { TaskDetailsForm } from "./task-details-form";

export const metadata: Metadata = {
  title: "Заявка — Repair Planner",
};

export default async function TaskPage({ params }: PageProps<"/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const supabase = await createClient();

  const [{ data: task }, { data: categories }, { data: executors }, { data: assigned }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, description, category_id, status")
        .eq("id", taskId)
        .eq("project_id", projectId)
        .maybeSingle(),
      supabase
        .from("categories")
        .select("id, name")
        .eq("project_id", projectId)
        .eq("is_archived", false)
        .order("sort_order", { ascending: true }),
      supabase
        .from("executors")
        .select("id, name, position, is_active")
        .eq("project_id", projectId)
        .order("name", { ascending: true }),
      supabase.from("task_executors").select("executor_id").eq("task_id", taskId),
    ]);

  if (!task) {
    notFound();
  }

  const assignedExecutorIds = assigned?.map((a) => a.executor_id) ?? [];

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Заявка</CardTitle>
          <StatusSelect projectId={projectId} taskId={taskId} status={task.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <TaskDetailsForm
            projectId={projectId}
            taskId={taskId}
            task={{
              title: task.title,
              description: task.description ?? "",
              categoryId: task.category_id ?? "",
            }}
            categories={categories ?? []}
          />

          <ExecutorsPicker
            projectId={projectId}
            taskId={taskId}
            executors={executors ?? []}
            assignedExecutorIds={assignedExecutorIds}
          />
        </CardContent>
      </Card>
    </main>
  );
}
