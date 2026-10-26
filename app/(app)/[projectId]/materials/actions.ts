"use server";

import { revalidatePath } from "next/cache";

import { isMaterialInOrder, isOrderList, orderItemTitle } from "@/lib/business/order-list";
import { isUniqueViolation, mapMaterialMovementError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import {
  createMaterialSchema,
  materialCountSchema,
  materialOrderSchema,
  materialReceiptSchema,
  materialSchema,
  type CreateMaterialInput,
  type MaterialCountInput,
  type MaterialInput,
  type MaterialOrderInput,
  type MaterialReceiptInput,
} from "@/lib/validation/reference-data";

import { createBoardItemAction } from "../board/actions";

function revalidateMaterials(projectId: string) {
  // "layout" — вместе со страницами отдельных материалов.
  revalidatePath(`/${projectId}/materials`, "layout");
}

export async function createMaterialAction(
  projectId: string,
  input: CreateMaterialInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = createMaterialSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  // current_balance не передаётся напрямую — по умолчанию 0. Начальный остаток
  // заносится через record_material_movement ниже, чтобы попасть в историю
  // движений (docs/database.md §7.4), а не в обход неё.
  const { data, error } = await supabase
    .from("materials")
    .insert({
      project_id: projectId,
      name: parsed.data.name,
      unit: parsed.data.unit,
      minimum_balance: parsed.data.minimumBalance,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Материал с таким названием уже есть." };
    }
    console.error("createMaterialAction:", error);
    return { ok: false, error: "Не удалось добавить материал. Попробуйте ещё раз." };
  }

  if (parsed.data.initialQuantity > 0) {
    const { error: movementError } = await supabase.rpc("record_material_movement", {
      p_material_id: data.id,
      p_kind: "receipt",
      p_quantity: parsed.data.initialQuantity,
      p_note: "Начальный остаток",
    });

    if (movementError) {
      console.error("createMaterialAction (initial receipt):", movementError);
      revalidateMaterials(projectId);
      return {
        ok: false,
        error: "Материал создан, но не удалось указать начальный остаток. Задайте его отдельно.",
      };
    }
  }

  revalidateMaterials(projectId);
  return { ok: true };
}

export async function updateMaterialAction(
  projectId: string,
  materialId: string,
  input: MaterialInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

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

// Приход и корректировка идут только через RPC (0010): остаток и запись
// журнала меняются в одной транзакции, доступ к проекту материала проверяет
// сама функция — не клиент.

export async function recordMaterialReceiptAction(
  projectId: string,
  materialId: string,
  input: MaterialReceiptInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = materialReceiptSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_material_movement", {
    p_material_id: materialId,
    p_kind: "receipt",
    p_quantity: parsed.data.quantity,
    p_note: parsed.data.note || undefined,
  });

  if (error) {
    console.error("recordMaterialReceiptAction:", error);
    return { ok: false, error: mapMaterialMovementError(error.message) };
  }

  revalidateMaterials(projectId);
  return { ok: true };
}

export async function setMaterialBalanceAction(
  projectId: string,
  materialId: string,
  input: MaterialCountInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = materialCountSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_material_balance", {
    p_material_id: materialId,
    p_actual_balance: parsed.data.actualBalance,
    p_note: parsed.data.note || undefined,
  });

  if (error) {
    console.error("setMaterialBalanceAction:", error);
    return { ok: false, error: mapMaterialMovementError(error.message) };
  }

  revalidateMaterials(projectId);
  return { ok: true };
}

/** «В заказ» из списка материалов: пункт в конец списка доски «Материалы к заказу». */
export async function addMaterialToOrderAction(
  projectId: string,
  materialId: string,
  input: MaterialOrderInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = materialOrderSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const failed = { ok: false, error: "Не удалось добавить в заказ. Попробуйте ещё раз." } as const;
  const supabase = await createClient();

  const { data: material, error: materialError } = await supabase
    .from("materials")
    .select("name, unit")
    .eq("id", materialId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (materialError) {
    console.error("addMaterialToOrderAction:", materialError);
    return failed;
  }
  if (!material) return { ok: false, error: "Материал не найден." };

  const { data: lists, error: listsError } = await supabase
    .from("board_lists")
    .select("id, name, is_system")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("created_at");

  if (listsError) {
    console.error("addMaterialToOrderAction:", listsError);
    return failed;
  }

  const list = (lists ?? []).find((l) => isOrderList(l.name, l.is_system));
  if (!list) return { ok: false, error: "Список «Материалы к заказу» не найден на доске." };

  const { data: openItems, error: itemsError } = await supabase
    .from("board_items")
    .select("title")
    .eq("project_id", projectId)
    .eq("list_id", list.id)
    .eq("is_done", false);

  if (itemsError) {
    console.error("addMaterialToOrderAction:", itemsError);
    return failed;
  }

  if (isMaterialInOrder(material.name, (openItems ?? []).map((item) => item.title))) {
    return { ok: false, error: "Этот материал уже есть в списке к заказу." };
  }

  const created = await createBoardItemAction(projectId, list.id, {
    title: orderItemTitle(material.name, parsed.data.quantity, material.unit),
  });
  if (!created.ok) return created;

  revalidateMaterials(projectId);
  return { ok: true };
}
