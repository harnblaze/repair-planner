import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { CarryOverButton } from "./carry-over-button";
import { ExecutorsPicker } from "./executors-picker";
import { PlanTaskForm } from "./plan-task-form";
import { StatusSelect } from "./status-select";
import { TaskDetailsForm } from "./task-details-form";
import { TaskMaterials } from "./task-materials";

export const metadata: Metadata = {
  title: "Заявка — Repair Planner",
};

export default async function TaskPage({ params }: PageProps<"/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const supabase = await createClient();

  const [
    { data: task },
    { data: categories },
    { data: executors },
    { data: assigned },
    { data: materials },
    { data: taskMaterials },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, description, category_id, status, planned_date")
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
    supabase
      .from("materials")
      .select("id, name, unit, current_balance, minimum_balance, is_active")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    supabase
      .from("task_materials")
      .select("id, material_id, quantity, note")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
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

          {/* key пересоздаёт форму при смене planned_date переносом (действие
              вне этого поля) — иначе локальное состояние поля не подхватит
              новую дату после router.refresh(). */}
          <PlanTaskForm
            key={task.planned_date ?? "unplanned"}
            projectId={projectId}
            taskId={taskId}
            plannedDate={task.planned_date}
          />

          <CarryOverButton
            projectId={projectId}
            taskId={taskId}
            plannedDate={task.planned_date}
            status={task.status}
          />

          <TaskMaterials
            projectId={projectId}
            taskId={taskId}
            materials={materials ?? []}
            taskMaterials={taskMaterials ?? []}
          />
        </CardContent>
      </Card>
    </main>
  );
}
