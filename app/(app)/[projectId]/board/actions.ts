"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

function revalidateBoard(projectId: string) {
  revalidatePath(`/${projectId}/board`);
}

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
