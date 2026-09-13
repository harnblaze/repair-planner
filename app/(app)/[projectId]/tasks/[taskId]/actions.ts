"use server";

import { revalidatePath } from "next/cache";

import { formatDateLong } from "@/lib/business/dates";
import { canCarryOverTask } from "@/lib/business/task-planning";
import type { TaskStatus } from "@/lib/business/task-status";
import { isWorkingDay, nextWorkingDay } from "@/lib/business/working-days";
import { isUniqueViolation, mapBoardMoveError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import {
  taskDescriptionSchema,
  taskMaterialSchema,
  taskTitleSchema,
  type TaskMaterialInput,
} from "@/lib/validation/task";

function revalidateTask(projectId: string, taskId: string) {
  revalidatePath(`/${projectId}/tasks/${taskId}`);
  revalidatePath(`/${projectId}/tasks`);
  revalidatePath(`/${projectId}/board`);
}

// Расход материала меняет materials.current_balance — экраны материалов
// (список, предупреждения о низком остатке) тоже должны увидеть новое значение.
function revalidateTaskMaterials(projectId: string, taskId: string) {
  revalidateTask(projectId, taskId);
  revalidatePath(`/${projectId}/materials`);
}

export async function updateTaskTitleAction(
  projectId: string,
  taskId: string,
  title: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
    .select("id, status, planned_date")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!task) {
    return { ok: false, error: "Заявка не найдена." };
  }

  // Задача сейчас в «Текущих заявках» (в т.ч. отложенная с историей дней) —
  // планируем тем же RPC, что и перетаскивание на доске: история сохраняется,
  // статус new → planned выставляется в той же транзакции.
  if (workDate && !task.planned_date) {
    const { error: planError } = await supabase.rpc("plan_task_on_day", {
      p_task_id: taskId,
      p_work_date: workDate,
    });

    if (planError) {
      console.error("setTaskPlannedDateAction (plan):", planError);
      return { ok: false, error: mapBoardMoveError(planError.message) };
    }

    revalidateTask(projectId, taskId);
    return { ok: true };
  }

  // Это ручной выбор конкретной даты (поле в карточке), а не перенос — он
  // заменяет весь план задачи, а не добавляет день. Перенос с сохранением
  // истории — отдельное действие, carryOverTaskAction ниже.
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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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

export async function carryOverTaskAction(
  projectId: string,
  taskId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, planned_date")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!task) {
    return { ok: false, error: "Заявка не найдена." };
  }
  if (!task.planned_date) {
    return { ok: false, error: "Заявка ещё не запланирована." };
  }
  if (!canCarryOverTask(task.status)) {
    return { ok: false, error: "Завершённую или отменённую заявку нельзя переносить." };
  }

  // Перенос добавляет новый день расписания и сохраняет предыдущие — задача
  // остаётся видимой во всех днях, в которых над ней работали (CLAUDE.md §27).
  const nextDate = nextWorkingDay(task.planned_date);

  const { count } = await supabase
    .from("task_schedule")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("work_date", nextDate);

  const { error: insertError } = await supabase.from("task_schedule").insert({
    project_id: projectId,
    task_id: taskId,
    work_date: nextDate,
    position: count ?? 0,
    carried_over: true,
    created_by: user.id,
  });

  if (insertError) {
    console.error("carryOverTaskAction:", insertError);
    if (insertError.code === "23505") {
      return { ok: false, error: "Заявка уже запланирована на этот день." };
    }
    return { ok: false, error: "Не удалось перенести заявку. Попробуйте ещё раз." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true, message: `Перенесено на ${formatDateLong(nextDate)}.` };
}

export async function addTaskMaterialAction(
  projectId: string,
  taskId: string,
  input: TaskMaterialInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskMaterialSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  // Расход и изменение остатка выполняются одним триггером на INSERT в
  // task_materials (docs/database.md §7.1) — отдельного шага не требуется.
  const { error } = await supabase.from("task_materials").insert({
    project_id: projectId,
    task_id: taskId,
    material_id: parsed.data.materialId,
    quantity: parsed.data.quantity,
    note: parsed.data.note || null,
    created_by: user.id,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Этот материал уже добавлен в заявку. Измените количество ниже." };
    }
    console.error("addTaskMaterialAction:", error);
    return { ok: false, error: "Не удалось добавить материал. Попробуйте ещё раз." };
  }

  revalidateTaskMaterials(projectId, taskId);
  return { ok: true };
}

export async function updateTaskMaterialAction(
  projectId: string,
  taskId: string,
  taskMaterialId: string,
  quantity: number,
  note: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskMaterialSchema.shape.quantity.safeParse(quantity);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректное количество." };
  }

  const supabase = await createClient();
  // Изменение количества пересчитывает остаток как корректировку delta =
  // -(новое − старое) — той же триггерной функцией, что и вставка (§7.1).
  const { data, error } = await supabase
    .from("task_materials")
    .update({ quantity: parsed.data, note: note.trim() || null })
    .eq("id", taskMaterialId)
    .eq("task_id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskMaterialAction:", error);
    return { ok: false, error: "Не удалось сохранить расход. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Запись расхода не найдена." };
  }

  revalidateTaskMaterials(projectId, taskId);
  return { ok: true };
}

export async function removeTaskMaterialAction(
  projectId: string,
  taskId: string,
  taskMaterialId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  // Удаление строки расхода возвращает списанное количество на остаток
  // (корректировка +quantity) — той же триггерной функцией (§7.1).
  const { data, error } = await supabase
    .from("task_materials")
    .delete()
    .eq("id", taskMaterialId)
    .eq("task_id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("removeTaskMaterialAction:", error);
    return { ok: false, error: "Не удалось удалить расход. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Запись расхода не найдена." };
  }

  revalidateTaskMaterials(projectId, taskId);
  return { ok: true };
}
