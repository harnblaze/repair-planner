import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/common/back-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { canReturnToBacklog } from "@/lib/business/task-planning";
import { addDays, nextWorkingDay } from "@/lib/business/working-days";
import { getProjectRole } from "@/lib/projects/access";
import { getWorkCalendar } from "@/lib/projects/calendar";
import { ATTACHMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/business/attachments";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { CarryOverButton } from "./carry-over-button";
import { ExecutorsPicker } from "./executors-picker";
import { PlanTaskForm } from "./plan-task-form";
import { ReturnToBacklogButton } from "./return-to-backlog-button";
import { StatusSelect } from "./status-select";
import {
  TaskCategoryField,
  TaskDescriptionField,
  TaskQueueField,
  TaskTitleField,
} from "./task-details-form";
import { TaskAttachments, type TaskPhoto } from "./task-attachments";
import { TaskMaterials } from "./task-materials";

export const metadata: Metadata = {
  title: "Заявка — Планировщик",
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

  // Строка свойств: три колонки или четыре, если есть поле очереди.
  const hasQueues = (queues ?? []).length > 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <BackLink fallbackHref={`/${projectId}/board`} />
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <TaskTitleField projectId={projectId} taskId={taskId} initialValue={task.title} disabled={!canEdit} />
          {/* key пересоздаёт список при смене статуса на сервере: дата плана
              меняет new ↔ planned (0015, 0028), а локальное состояние списка
              иначе не подхватит новый статус после router.refresh(). */}
          <StatusSelect
            key={task.status}
            projectId={projectId}
            taskId={taskId}
            status={task.status}
            disabled={!canEdit}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className={cn("grid grid-cols-2 gap-3", hasQueues ? "md:grid-cols-4" : "md:grid-cols-3")}>
            <TaskCategoryField
              projectId={projectId}
              taskId={taskId}
              initialValue={task.category_id ?? ""}
              categories={categories ?? []}
              disabled={!canEdit}
            />
            {hasQueues ? (
              <TaskQueueField
                projectId={projectId}
                taskId={taskId}
                initialValue={task.queue_id ?? ""}
                queues={queues ?? []}
                disabled={!canEdit}
              />
            ) : null}
            <ExecutorsPicker
              projectId={projectId}
              taskId={taskId}
              executors={executors ?? []}
              assignedExecutorIds={assignedExecutorIds}
              disabled={!canEdit}
            />
            {/* key пересоздаёт поле при смене planned_date переносом (действие
                вне этого поля) — иначе локальное состояние поля не подхватит
                новую дату после router.refresh(). */}
            <PlanTaskForm
              key={task.planned_date ?? "unplanned"}
              projectId={projectId}
              taskId={taskId}
              plannedDate={task.planned_date}
              disabled={!canEdit}
            />
          </div>

          {/* Обёртка — только когда кнопки видны, иначе пустой блок добавит отступ. */}
          {canEdit && task.planned_date && canReturnToBacklog(task.status) ? (
            <div className="flex flex-wrap gap-2">
              <CarryOverButton
                projectId={projectId}
                taskId={taskId}
                plannedDate={task.planned_date}
                nextDate={nextDate}
                status={task.status}
              />
              <ReturnToBacklogButton
                projectId={projectId}
                taskId={taskId}
                plannedDate={task.planned_date}
                status={task.status}
              />
            </div>
          ) : null}

          <TaskDescriptionField
            projectId={projectId}
            taskId={taskId}
            initialValue={task.description ?? ""}
            disabled={!canEdit}
          />

          <div className="border-t border-line-subtle pt-3">
            <TaskMaterials
              projectId={projectId}
              taskId={taskId}
              materials={materials ?? []}
              taskMaterials={taskMaterials ?? []}
              canEdit={canEdit}
            />
          </div>

          <div className="border-t border-line-subtle pt-3">
            <TaskAttachments projectId={projectId} taskId={taskId} photos={photos} canEdit={canEdit} />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
