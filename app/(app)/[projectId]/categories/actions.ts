"use server";

import { revalidatePath } from "next/cache";

import { isUniqueViolation } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { categorySchema, type CategoryInput } from "@/lib/validation/reference-data";

function revalidateCategories(projectId: string) {
  revalidatePath(`/${projectId}/categories`);
}

export async function createCategoryAction(
  projectId: string,
  input: CategoryInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = categorySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ project_id: projectId, name: parsed.data.name });

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Категория с таким названием уже есть." };
    }
    console.error("createCategoryAction:", error);
    return { ok: false, error: "Не удалось создать категорию. Попробуйте ещё раз." };
  }

  revalidateCategories(projectId);
  return { ok: true };
}

export async function updateCategoryAction(
  projectId: string,
  categoryId: string,
  input: CategoryInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = categorySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ name: parsed.data.name })
    .eq("id", categoryId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Категория с таким названием уже есть." };
    }
    console.error("updateCategoryAction:", error);
    return { ok: false, error: "Не удалось сохранить категорию. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Категория не найдена." };
  }

  revalidateCategories(projectId);
  return { ok: true };
}

export async function setCategoryArchivedAction(
  projectId: string,
  categoryId: string,
  isArchived: boolean,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_archived: isArchived })
    .eq("id", categoryId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("setCategoryArchivedAction:", error);
    return { ok: false, error: "Не удалось изменить категорию. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Категория не найдена." };
  }

  revalidateCategories(projectId);
  return { ok: true };
}
