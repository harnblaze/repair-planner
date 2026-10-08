"use server";

import { revalidatePath } from "next/cache";

import { mapBoardMoveError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { boardListSchema, type BoardListInput } from "@/lib/validation/board-list";
import { idSchema, moveBoardListSchema, type MoveBoardListInput } from "@/lib/validation/board-move";
import {
  moveTaskQueueSchema,
  taskQueueSchema,
  type MoveTaskQueueInput,
  type TaskQueueInput,
} from "@/lib/validation/task-queue";

// Дополнительные списки доски (board_lists). Системные списки создаёт БД при
// создании проекта; здесь создаются только пользовательские. Системный список
// нельзя удалить и нельзя сделать пользовательским — это закреплено в RLS и
// триггере (supabase/migrations/0006, 0014), проверки здесь — только UX.
//
// Очереди текущих заявок (task_queues, 0018) — здесь же: основная очередь
// строки не имеет, удаляются и переименовываются только дополнительные.

function revalidateLists(projectId: string) {
  revalidatePath(`/${projectId}/board`);
  revalidatePath(`/${projectId}/settings/lists`);
  revalidatePath(`/${projectId}/tasks`);
}

const LIST_NOT_FOUND: ActionResult = { ok: false, error: "Список не найден. Обновите страницу." };

export async function createBoardListAction(
  projectId: string,
  input: BoardListInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = boardListSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  // Новый список — в конец. Одновременное создание даст одинаковый sort_order;
  // порядок при этом определяется датой создания, а move_board_list перенумерует.
  const { data: last } = await supabase
    .from("board_lists")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("board_lists").insert({
    project_id: projectId,
    name: parsed.data.name,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) {
    console.error("createBoardListAction:", error);
    return { ok: false, error: "Не удалось создать список. Попробуйте ещё раз." };
  }

  revalidateLists(projectId);
  return { ok: true };
}

export async function renameBoardListAction(
  projectId: string,
  listId: string,
  input: BoardListInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = boardListSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  if (!idSchema.safeParse(listId).success) return LIST_NOT_FOUND;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_lists")
    .update({ name: parsed.data.name })
    .eq("id", listId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("renameBoardListAction:", error);
    return { ok: false, error: "Не удалось переименовать список. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return LIST_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}

export async function deleteBoardListAction(
  projectId: string,
  listId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!idSchema.safeParse(listId).success) return LIST_NOT_FOUND;

  const supabase = await createClient();
  // Записи списка удаляются каскадом (board_items → board_lists on delete cascade).
  const { data, error } = await supabase
    .from("board_lists")
    .delete()
    .eq("id", listId)
    .eq("project_id", projectId)
    .eq("is_system", false)
    .select("id");

  if (error) {
    console.error("deleteBoardListAction:", error);
    return { ok: false, error: "Не удалось удалить список. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return LIST_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}

export async function moveBoardListAction(
  projectId: string,
  input: MoveBoardListInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = moveBoardListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Не удалось переместить. Обновите страницу." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_board_list", {
    p_list_id: parsed.data.listId,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("moveBoardListAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateLists(projectId);
  return { ok: true };
}

const QUEUE_NOT_FOUND: ActionResult = { ok: false, error: "Очередь не найдена. Обновите страницу." };

export async function createTaskQueueAction(
  projectId: string,
  input: TaskQueueInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskQueueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  // Новая очередь — в конец, как новый список; одинаковый sort_order при
  // одновременном создании разрешится сортировкой по created_at.
  const { data: last } = await supabase
    .from("task_queues")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("task_queues")
    .insert({ project_id: projectId, name: parsed.data.name, sort_order: (last?.sort_order ?? -1) + 1 });

  if (error) {
    console.error("createTaskQueueAction:", error);
    return { ok: false, error: "Не удалось создать очередь. Попробуйте ещё раз." };
  }

  revalidateLists(projectId);
  return { ok: true };
}

export async function renameTaskQueueAction(
  projectId: string,
  queueId: string,
  input: TaskQueueInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskQueueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  if (!idSchema.safeParse(queueId).success) return QUEUE_NOT_FOUND;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_queues")
    .update({ name: parsed.data.name })
    .eq("id", queueId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("renameTaskQueueAction:", error);
    return { ok: false, error: "Не удалось переименовать очередь. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return QUEUE_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}

export async function moveTaskQueueAction(
  projectId: string,
  input: MoveTaskQueueInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = moveTaskQueueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Не удалось переместить. Обновите страницу." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_task_queue", {
    p_queue_id: parsed.data.queueId,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("moveTaskQueueAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateLists(projectId);
  return { ok: true };
}

export async function deleteTaskQueueAction(
  projectId: string,
  queueId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!idSchema.safeParse(queueId).success) return QUEUE_NOT_FOUND;

  const supabase = await createClient();
  // Заявки очереди переходят в основную (tasks_queue_fk on delete set null).
  const { data, error } = await supabase
    .from("task_queues")
    .delete()
    .eq("id", queueId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("deleteTaskQueueAction:", error);
    return { ok: false, error: "Не удалось удалить очередь. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return QUEUE_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}
