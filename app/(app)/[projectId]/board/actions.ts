"use server";

import { revalidatePath } from "next/cache";

import { mapBoardMoveError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";
import {
  idSchema,
  moveBoardItemSchema,
  moveTaskScheduleSchema,
  planTaskOnDaySchema,
  type MoveBoardItemInput,
  type MoveTaskScheduleInput,
  type PlanTaskOnDayInput,
} from "@/lib/validation/board-move";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

function revalidateBoard(projectId: string) {
  revalidatePath(`/${projectId}/board`);
}

// Перемещение меняет план и статус задачи — карточка и список заявок тоже должны обновиться.
function revalidateTaskPlan(projectId: string, taskId: string) {
  revalidateBoard(projectId);
  revalidatePath(`/${projectId}/tasks`);
  revalidatePath(`/${projectId}/tasks/${taskId}`);
}

const INVALID_MOVE: ActionResult = { ok: false, error: "Не удалось переместить. Обновите страницу." };

// В отличие от app/(app)/[projectId]/tasks/actions.ts::createTaskAction, здесь
// нет редиректа на карточку — задача создаётся прямо с доски и сразу видна
// в «Текущих заявках», без переключения между страницами.
export async function createTaskFromBoardAction(
  projectId: string,
  input: CreateTaskInput,
): Promise<ActionResult> {
  const parsed = createTaskSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
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

  const { error } = await supabase.from("tasks").insert({
    project_id: projectId,
    title: parsed.data.title,
    category_id: parsed.data.categoryId || null,
    created_by: user.id,
  });

  if (error) {
    console.error("createTaskFromBoardAction:", error);
    return { ok: false, error: "Не удалось создать заявку. Попробуйте ещё раз." };
  }

  revalidateBoard(projectId);
  revalidatePath(`/${projectId}/tasks`);
  return { ok: true };
}

export async function createBoardItemAction(
  projectId: string,
  listId: string,
  input: BoardItemInput,
): Promise<ActionResult> {
  const parsed = boardItemSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
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

  const { count } = await supabase
    .from("board_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("list_id", listId);

  const { error } = await supabase.from("board_items").insert({
    project_id: projectId,
    list_id: listId,
    title: parsed.data.title,
    note: parsed.data.note || null,
    due_date: parsed.data.dueDate || null,
    position: count ?? 0,
    created_by: user.id,
  });

  if (error) {
    console.error("createBoardItemAction:", error);
    return { ok: false, error: "Не удалось добавить запись. Попробуйте ещё раз." };
  }

  revalidateBoard(projectId);
  return { ok: true };
}

export async function updateBoardItemAction(
  projectId: string,
  itemId: string,
  input: BoardItemInput,
): Promise<ActionResult> {
  const parsed = boardItemSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_items")
    .update({
      title: parsed.data.title,
      note: parsed.data.note || null,
      due_date: parsed.data.dueDate || null,
    })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateBoardItemAction:", error);
    return { ok: false, error: "Не удалось сохранить запись. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Запись не найдена." };
  }

  revalidateBoard(projectId);
  return { ok: true };
}

export async function setBoardItemDoneAction(
  projectId: string,
  itemId: string,
  isDone: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_items")
    .update({ is_done: isDone })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("setBoardItemDoneAction:", error);
    return { ok: false, error: "Не удалось изменить запись. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Запись не найдена." };
  }

  revalidateBoard(projectId);
  return { ok: true };
}

export async function deleteBoardItemAction(
  projectId: string,
  itemId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("deleteBoardItemAction:", error);
    return { ok: false, error: "Не удалось удалить запись. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Запись не найдена." };
  }

  revalidateBoard(projectId);
  return { ok: true };
}

// ================= Drag-and-drop =================
// Каждое перемещение — один вызов RPC: перестановка позиций, смена дня и
// пересчёт planned_date выполняются в одной транзакции (supabase/migrations/0008).
// Доступ к проекту проверяет RLS внутри RPC; project_id из URL используется
// только для revalidatePath.

export async function planTaskOnDayAction(
  projectId: string,
  input: PlanTaskOnDayInput,
): Promise<ActionResult> {
  const parsed = planTaskOnDaySchema.safeParse(input);
  if (!parsed.success) return INVALID_MOVE;

  const supabase = await createClient();
  const { error } = await supabase.rpc("plan_task_on_day", {
    p_task_id: parsed.data.taskId,
    p_work_date: parsed.data.workDate,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("planTaskOnDayAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateTaskPlan(projectId, parsed.data.taskId);
  return { ok: true };
}

export async function moveTaskScheduleAction(
  projectId: string,
  input: MoveTaskScheduleInput,
): Promise<ActionResult> {
  const parsed = moveTaskScheduleSchema.safeParse(input);
  if (!parsed.success) return INVALID_MOVE;

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_task_schedule", {
    p_task_id: parsed.data.taskId,
    p_from_date: parsed.data.fromDate,
    p_to_date: parsed.data.toDate,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("moveTaskScheduleAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateTaskPlan(projectId, parsed.data.taskId);
  return { ok: true };
}

export async function returnTaskToBacklogAction(
  projectId: string,
  taskId: string,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(taskId);
  if (!parsed.success) return INVALID_MOVE;

  const supabase = await createClient();
  const { data: keptHistory, error } = await supabase.rpc("return_task_to_backlog", {
    p_task_id: parsed.data,
  });

  if (error) {
    console.error("returnTaskToBacklogAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateTaskPlan(projectId, parsed.data);
  return {
    ok: true,
    message: keptHistory
      ? "Заявка отложена. Дни работы над ней сохранены в истории."
      : "Заявка снята с плана.",
  };
}

export async function moveBoardItemAction(
  projectId: string,
  input: MoveBoardItemInput,
): Promise<ActionResult> {
  const parsed = moveBoardItemSchema.safeParse(input);
  if (!parsed.success) return INVALID_MOVE;

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_board_item", {
    p_item_id: parsed.data.itemId,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("moveBoardItemAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateBoard(projectId);
  return { ok: true };
}
