import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/common/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { addDays, nextWorkingDay } from "@/lib/business/working-days";
import { getProjectRole } from "@/lib/projects/access";
import { getWorkCalendar } from "@/lib/projects/calendar";
import { ATTACHMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/business/attachments";
import { createClient } from "@/lib/supabase/server";

import { CarryOverButton } from "./carry-over-button";
import { ExecutorsPicker } from "./executors-picker";
import { PlanTaskForm } from "./plan-task-form";
import { StatusSelect } from "./status-select";
import { TaskDetailsForm } from "./task-details-form";
import { TaskAttachments, type TaskPhoto } from "./task-attachments";
import { TaskMaterials } from "./task-materials";

export const metadata: Metadata = {
  title: "Заявка — Repair Planner",
};

export default async function TaskPage({ params }: PageProps<"/[projectId]/tasks/[taskId]">) {
  const { projectId, taskId } = await params;
  const supabase = await createClient();

  const [
    role,
    { data: task },
    { data: categories },
    { data: executors },
    { data: assigned },
    { data: materials },
    { data: taskMaterials },
    { data: attachments },
    { data: queues },
  ] = await Promise.all([
    getProjectRole(projectId),
    supabase
      .from("tasks")
      .select("id, title, description, category_id, queue_id, status, planned_date")
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
    supabase
      .from("task_attachments")
      .select("id, storage_path, width, height")
      .eq("task_id", taskId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (!task) {
    notFound();
  }

  const assignedExecutorIds = assigned?.map((a) => a.executor_id) ?? [];
  const canEdit = canEditProject(role);

  // Ссылки на просмотр подписываются одним запросом; RLS storage.objects
  // пропускает только участников проекта.
  let photos: TaskPhoto[] = [];
  if (attachments && attachments.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(
        attachments.map((a) => a.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signError) console.error("TaskPage (sign attachments):", signError);
    const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    photos = attachments.map((a) => ({
      id: a.id,
      url: urlByPath.get(a.storage_path) ?? null,
      width: a.width,
      height: a.height,
    }));
  }

  // Подпись кнопки переноса. Месяца исключений достаточно: столько нерабочих
  // дней подряд не бывает. Без календаря дата не показывается — перенос всё
  // равно считает БД.
  let nextDate: string | null = null;
  if (canEdit && task.planned_date) {
    const calendar = await getWorkCalendar(projectId, task.planned_date, addDays(task.planned_date, 31));
    nextDate = calendar ? nextWorkingDay(task.planned_date, calendar) : null;
  }

  return (
    <main className="mx-auto flex max-w-lg w-full flex-col gap-4 px-5 pt-6 pb-7">
      <BackLink fallbackHref={`/${projectId}/board`} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Заявка</CardTitle>
          <StatusSelect
            projectId={projectId}
            taskId={taskId}
            status={task.status}
            disabled={!canEdit}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <TaskDetailsForm
            projectId={projectId}
            taskId={taskId}
            task={{
              title: task.title,
              description: task.description ?? "",
              categoryId: task.category_id ?? "",
              queueId: task.queue_id ?? "",
            }}
            categories={categories ?? []}
            queues={queues ?? []}
            disabled={!canEdit}
          />

          <ExecutorsPicker
            projectId={projectId}
            taskId={taskId}
            executors={executors ?? []}
            assignedExecutorIds={assignedExecutorIds}
            disabled={!canEdit}
          />

          {/* key пересоздаёт форму при смене planned_date переносом (действие
              вне этого поля) — иначе локальное состояние поля не подхватит
              новую дату после router.refresh(). */}
          <PlanTaskForm
            key={task.planned_date ?? "unplanned"}
            projectId={projectId}
            taskId={taskId}
            plannedDate={task.planned_date}
            disabled={!canEdit}
          />

          {canEdit ? (
            <CarryOverButton
              projectId={projectId}
              taskId={taskId}
              plannedDate={task.planned_date}
              nextDate={nextDate}
              status={task.status}
            />
          ) : null}

          <TaskMaterials
            projectId={projectId}
            taskId={taskId}
            materials={materials ?? []}
            taskMaterials={taskMaterials ?? []}
            canEdit={canEdit}
          />

          <TaskAttachments projectId={projectId} taskId={taskId} photos={photos} canEdit={canEdit} />
        </CardContent>
      </Card>
    </main>
  );
}
