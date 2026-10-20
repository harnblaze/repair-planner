"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { mapSupplyError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import {
  supplyItemEditSchema,
  supplyItemsSchema,
  supplyRequestSchema,
  type SupplyItemEditInput,
  type SupplyItemInput,
  type SupplyRequestInput,
} from "@/lib/validation/supply";

// Снабжение (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §6.2).
// Гарантию прав даёт RLS; requireProjectEdit нужен, чтобы отфильтрованный
// политикой до 0 строк UPDATE/DELETE не выглядел успешным.

const INVALID_FORM = "Проверьте правильность заполнения формы.";
const NOT_FOUND = "Запись не найдена. Обновите страницу.";

function revalidateSupply(projectId: string) {
  revalidatePath(`/${projectId}/supply`);
}

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, error: INVALID_FORM, fieldErrors: error.flatten().fieldErrors as Record<string, string[]> };
}

function failed(where: string, error: { code?: string; message?: string }): ActionResult {
  console.error(`${where}:`, error);
  return { ok: false, error: mapSupplyError(error) };
}

/** Результат UPDATE/DELETE с .select("id"): 0 строк — запись исчезла или прав больше нет. */
function affected(where: string, projectId: string, result: { data: unknown[] | null; error: { code?: string; message?: string } | null }): ActionResult {
  if (result.error) return failed(where, result.error);
  if (!result.data || result.data.length === 0) return { ok: false, error: NOT_FOUND };
  revalidateSupply(projectId);
  return { ok: true };
}

const itemRow = (item: SupplyItemInput) => ({
  line_no: item.lineNo,
  name: item.name,
  unit: item.unit,
  quantity: item.quantity,
  note: item.note || null,
});

// ================= Заявка =================

export async function createSupplyRequestAction(
  projectId: string,
  input: SupplyRequestInput,
  items: SupplyItemInput[],
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const header = supplyRequestSchema.safeParse(input);
  if (!header.success) return invalid(header.error);
  const lines = items.length === 0 ? { success: true as const, data: [] } : supplyItemsSchema.safeParse(items);
  if (!lines.success) return invalid(lines.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_supply_request", {
    p_project_id: projectId,
    p_number: header.data.number,
    p_request_date: header.data.requestDate,
    p_description: header.data.description ?? "",
    p_items: lines.data.map(itemRow),
  });

  if (error) return failed("createSupplyRequestAction", error);
  revalidateSupply(projectId);
  return { ok: true };
}

export async function updateSupplyRequestAction(
  projectId: string,
  requestId: string,
  input: SupplyRequestInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const result = await supabase
    .from("supply_requests")
    .update({
      number: parsed.data.number,
      request_date: parsed.data.requestDate,
      description: parsed.data.description || null,
    })
    .eq("id", requestId)
    .eq("project_id", projectId)
    .select("id");

  return affected("updateSupplyRequestAction", projectId, result);
}

export async function deleteSupplyRequestAction(projectId: string, requestId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_requests")
    .delete()
    .eq("id", requestId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyRequestAction", projectId, result);
}

// ================= Позиции =================

/** Пачка позиций в существующую заявку — одна вставка массива, атомарно. */
export async function addSupplyItemsAction(
  projectId: string,
  requestId: string,
  items: SupplyItemInput[],
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyItemsSchema.safeParse(items);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("supply_request_items")
    .insert(parsed.data.map((item) => ({ ...itemRow(item), project_id: projectId, request_id: requestId })));

  if (error) return failed("addSupplyItemsAction", error);
  revalidateSupply(projectId);
  return { ok: true };
}

export async function updateSupplyItemAction(
  projectId: string,
  itemId: string,
  input: SupplyItemEditInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyItemEditSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const result = await supabase
    .from("supply_request_items")
    .update({ ...itemRow(parsed.data), material_id: parsed.data.materialId })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  return affected("updateSupplyItemAction", projectId, result);
}

export async function setSupplyItemCancelledAction(
  projectId: string,
  itemId: string,
  cancelled: boolean,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_request_items")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  return affected("setSupplyItemCancelledAction", projectId, result);
}

export async function deleteSupplyItemAction(projectId: string, itemId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_request_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyItemAction", projectId, result);
}
