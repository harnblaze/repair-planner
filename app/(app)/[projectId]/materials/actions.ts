"use server";

import { revalidatePath } from "next/cache";

import { isUniqueViolation } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { materialSchema, type MaterialInput } from "@/lib/validation/reference-data";

function revalidateMaterials(projectId: string) {
  revalidatePath(`/${projectId}/materials`);
}

export async function createMaterialAction(
  projectId: string,
  input: MaterialInput,
): Promise<ActionResult> {
  const parsed = materialSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  // current_balance не передаётся — по умолчанию 0, менять его может только
  // будущая функция движения материалов (приход/расход), см. §22 архитектуры.
  const { error } = await supabase.from("materials").insert({
    project_id: projectId,
    name: parsed.data.name,
    unit: parsed.data.unit,
    minimum_balance: parsed.data.minimumBalance,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Материал с таким названием уже есть." };
    }
    console.error("createMaterialAction:", error);
    return { ok: false, error: "Не удалось добавить материал. Попробуйте ещё раз." };
  }

  revalidateMaterials(projectId);
  return { ok: true };
}

export async function updateMaterialAction(
  projectId: string,
  materialId: string,
  input: MaterialInput,
): Promise<ActionResult> {
  const parsed = materialSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .update({
      name: parsed.data.name,
      unit: parsed.data.unit,
      minimum_balance: parsed.data.minimumBalance,
    })
    .eq("id", materialId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Материал с таким названием уже есть." };
    }
    console.error("updateMaterialAction:", error);
    return { ok: false, error: "Не удалось сохранить материал. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Материал не найден." };
  }

  revalidateMaterials(projectId);
  return { ok: true };
}

export async function setMaterialActiveAction(
  projectId: string,
  materialId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .update({ is_active: isActive })
    .eq("id", materialId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("setMaterialActiveAction:", error);
    return { ok: false, error: "Не удалось изменить материал. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Материал не найден." };
  }

  revalidateMaterials(projectId);
  return { ok: true };
}
