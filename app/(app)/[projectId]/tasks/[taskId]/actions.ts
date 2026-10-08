"use server";

import { revalidatePath } from "next/cache";

import { formatDateLong } from "@/lib/business/dates";
import { canCarryOverTask } from "@/lib/business/task-planning";
import { closedTimestamps, type TaskStatus } from "@/lib/business/task-status";
import { isValidDateString, isWorkingDay } from "@/lib/business/working-days";
import { isUniqueViolation, mapBoardMoveError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { getWorkCalendar } from "@/lib/projects/calendar";
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

// Смена очереди — обычный UPDATE под RLS: очередь чужого проекта отвергает
// составной FK tasks_queue_fk, позицию в очереди сбрасывает триггер (0018).
export async function updateTaskQueueAction(
  projectId: string,
  taskId: string,
  queueId: string | null,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ queue_id: queueId || null })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskQueueAction:", error);
    return { ok: false, error: "Не удалось сменить очередь. Обновите страницу и попробуйте ещё раз." };
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
    .update({ status, ...closedTimestamps(status, new Date()) })
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

  if (workDate && !isValidDateString(workDate)) {
    return { ok: false, error: "Укажите дату." };
  }

  // БД проверит рабочий день сама (0013, 0015); здесь — только ради сообщения с датой.
  if (workDate) {
    const calendar = await getWorkCalendar(projectId, workDate, workDate);
    if (!calendar) {
      return { ok: false, error: "Не удалось изменить план. Попробуйте ещё раз." };
    }
    if (!isWorkingDay(workDate, calendar)) {
      return { ok: false, error: `${formatDateLong(workDate)} — нерабочий день. Выберите рабочий день.` };
    }
  }

  // Ручной выбор даты заменяет весь план задачи (не перенос — см. carryOverTaskAction).
  // Снятие плана, замена дня и смена статуса new → planned — одна транзакция (0015).
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_planned_date", {
    p_project_id: projectId,
    p_task_id: taskId,
    p_work_date: workDate ?? undefined,
  });

  if (error) {
    console.error("setTaskPlannedDateAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message, "Не удалось изменить план. Попробуйте ещё раз.") };
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

// Коды исключений public.carry_over_task (supabase/migrations/0013).
const CARRY_OVER_ERROR_MESSAGES: Record<string, string> = {
  task_not_found: "Заявка не найдена.",
  task_closed: "Завершённую или отменённую заявку нельзя переносить.",
  task_not_planned: "Заявка ещё не запланирована.",
  no_working_day: "В календаре проекта не найден следующий рабочий день.",
};

export async function carryOverTaskAction(
  projectId: string,
  taskId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
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
  // Следующий рабочий день по календарю проекта считает RPC в той же транзакции.
  const { data: nextDate, error } = await supabase.rpc("carry_over_task", { p_task_id: taskId });

  if (error || !nextDate) {
    console.error("carryOverTaskAction:", error);
    return {
      ok: false,
      error:
        (error?.message && CARRY_OVER_ERROR_MESSAGES[error.message]) ||
        "Не удалось перенести заявку. Попробуйте ещё раз.",
    };
  }

  revalidateTask(projectId, taskId);
  return { ok: true, message: `Перенесено на ${formatDateLong(nextDate)}.` };
}

const UNDO_CARRY_OVER_ERROR_MESSAGES: Record<string, string> = {
  task_not_found: "Заявка не найдена.",
  task_closed: "Завершённую или отменённую заявку нельзя изменить.",
  nothing_to_undo: "Отменять нечего: последний день заявки не был переносом.",
  carry_over_too_old: "Перенесённый день уже прошёл — перенос нельзя отменить.",
};

/** Отмена переноса: удаляет последний перенесённый день (RPC undo_carry_over, 0021). */
export async function undoCarryOverTaskAction(projectId: string, taskId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!task) {
    return { ok: false, error: "Заявка не найдена." };
  }

  const { data: previousDate, error } = await supabase.rpc("undo_carry_over", { p_task_id: taskId });

  if (error || !previousDate) {
    console.error("undoCarryOverTaskAction:", error);
    return {
      ok: false,
      error:
        (error?.message && UNDO_CARRY_OVER_ERROR_MESSAGES[error.message]) ||
        "Не удалось отменить перенос. Попробуйте ещё раз.",
    };
  }

  revalidateTask(projectId, taskId);
  return { ok: true, message: `Перенос отменён: заявка снова на ${formatDateLong(previousDate)}.` };
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
