"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/business/task-status";
import type { ActionResult } from "@/lib/types/action-result";
import { updateTaskSchema, type UpdateTaskInput } from "@/lib/validation/task";

function revalidateTask(projectId: string, taskId: string) {
  revalidatePath(`/${projectId}/tasks/${taskId}`);
  revalidatePath(`/${projectId}/tasks`);
}

export async function updateTaskAction(
  projectId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<ActionResult> {
  const parsed = updateTaskSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      // category_id и project_id связаны составным внешним ключом (см. docs/database.md §4) —
      // категория из чужого проекта будет отклонена на уровне БД, а не только здесь.
      category_id: parsed.data.categoryId || null,
    })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskAction:", error);
    return { ok: false, error: "Не удалось сохранить заявку. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Заявка не найдена." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}

export async function setTaskStatusAction(
  projectId: string,
  taskId: string,
  status: TaskStatus,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status,
      // completed_at и status согласованы CHECK-ограничением в БД — обязаны
      // выставлять оба поля вместе.
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("setTaskStatusAction:", error);
    return { ok: false, error: "Не удалось изменить статус. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Заявка не найдена." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}

export async function setTaskExecutorsAction(
  projectId: string,
  taskId: string,
  executorIds: string[],
): Promise<ActionResult> {
  const supabase = await createClient();

  // Убеждаемся, что задача действительно в этом проекте, прежде чем менять
  // назначения — иначе при отсутствии доступа проверка не сработает молча.
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!task) {
    return { ok: false, error: "Заявка не найдена." };
  }

  const { error: deleteError } = await supabase
    .from("task_executors")
    .delete()
    .eq("task_id", taskId)
    .eq("project_id", projectId);

  if (deleteError) {
    console.error("setTaskExecutorsAction (delete):", deleteError);
    return { ok: false, error: "Не удалось изменить исполнителей. Попробуйте ещё раз." };
  }

  if (executorIds.length > 0) {
    const { error: insertError } = await supabase.from("task_executors").insert(
      executorIds.map((executorId) => ({
        task_id: taskId,
        executor_id: executorId,
        project_id: projectId,
      })),
    );

    if (insertError) {
      console.error("setTaskExecutorsAction (insert):", insertError);
      return { ok: false, error: "Не удалось изменить исполнителей. Попробуйте ещё раз." };
    }
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}
