"use server";

import { revalidatePath } from "next/cache";

import type { TaskStatus } from "@/lib/business/task-status";
import { isWorkingDay } from "@/lib/business/working-days";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { taskDescriptionSchema, taskTitleSchema } from "@/lib/validation/task";

function revalidateTask(projectId: string, taskId: string) {
  revalidatePath(`/${projectId}/tasks/${taskId}`);
  revalidatePath(`/${projectId}/tasks`);
  revalidatePath(`/${projectId}/board`);
}

export async function updateTaskTitleAction(
  projectId: string,
  taskId: string,
  title: string,
): Promise<ActionResult> {
  const parsed = taskTitleSchema.safeParse(title);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректное название." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ title: parsed.data })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskTitleAction:", error);
    return { ok: false, error: "Не удалось сохранить название. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Заявка не найдена." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}

export async function updateTaskDescriptionAction(
  projectId: string,
  taskId: string,
  description: string,
): Promise<ActionResult> {
  const parsed = taskDescriptionSchema.safeParse(description);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректное описание." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ description: parsed.data || null })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskDescriptionAction:", error);
    return { ok: false, error: "Не удалось сохранить описание. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Заявка не найдена." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}

export async function updateTaskCategoryAction(
  projectId: string,
  taskId: string,
  categoryId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    // category_id и project_id связаны составным внешним ключом (см. docs/database.md §4) —
    // категория из чужого проекта будет отклонена на уровне БД, а не только здесь.
    .update({ category_id: categoryId || null })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskCategoryAction:", error);
    return { ok: false, error: "Не удалось сохранить категорию. Попробуйте ещё раз." };
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

export async function setTaskPlannedDateAction(
  projectId: string,
  taskId: string,
  workDate: string | null,
): Promise<ActionResult> {
  if (workDate && (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !isWorkingDay(workDate))) {
    return { ok: false, error: "Планировать можно только на рабочий день (Пн–Пт)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!task) {
    return { ok: false, error: "Заявка не найдена." };
  }

  // У задачи в любой момент только один текущий плановый день (не история) —
  // «Перенос» с сохранением истории появится отдельным действием на этапе 8.
  // Поэтому сначала полностью снимаем текущее планирование, а не добавляем к нему.
  const { error: deleteError } = await supabase
    .from("task_schedule")
    .delete()
    .eq("task_id", taskId)
    .eq("project_id", projectId);

  if (deleteError) {
    console.error("setTaskPlannedDateAction (delete):", deleteError);
    return { ok: false, error: "Не удалось изменить план. Попробуйте ещё раз." };
  }

  if (workDate) {
    const { count } = await supabase
      .from("task_schedule")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("work_date", workDate);

    const { error: insertError } = await supabase.from("task_schedule").insert({
      project_id: projectId,
      task_id: taskId,
      work_date: workDate,
      position: count ?? 0,
      created_by: user.id,
    });

    if (insertError) {
      console.error("setTaskPlannedDateAction (insert):", insertError);
      return { ok: false, error: "Не удалось запланировать заявку. Попробуйте ещё раз." };
    }

    // Первое планирование новой заявки переводит её в статус «Запланирована».
    // Если статус уже другой (в работе, приостановлена и т.д.) — не трогаем его.
    if (task.status === "new") {
      await supabase
        .from("tasks")
        .update({ status: "planned" })
        .eq("id", taskId)
        .eq("status", "new");
    }
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
