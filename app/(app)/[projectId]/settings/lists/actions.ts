"use server";

import { revalidatePath } from "next/cache";

import { mapBoardMoveError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { boardListSchema, type BoardListInput } from "@/lib/validation/board-list";
import { idSchema, moveBoardListSchema, type MoveBoardListInput } from "@/lib/validation/board-move";

// Дополнительные списки доски (board_lists). Системные списки создаёт БД при
// создании проекта; здесь создаются только пользовательские. Системный список
// нельзя удалить и нельзя сделать пользовательским — это закреплено в RLS и
// триггере (supabase/migrations/0006, 0014), проверки здесь — только UX.

function revalidateLists(projectId: string) {
  revalidatePath(`/${projectId}/board`);
  revalidatePath(`/${projectId}/settings/lists`);
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
