"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { isUniqueViolation, mapSupplyError } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { materialSchema } from "@/lib/validation/reference-data";
import {
  positiveQuantity,
  supplyDeliverySchema,
  supplyInvoiceLineSchema,
  supplyInvoiceLinesSchema,
  supplyInvoiceSchema,
  supplyItemEditSchema,
  supplyItemsSchema,
  supplyReceiveSchema,
  supplyRequestSchema,
  type SupplyDeliveryInput,
  type SupplyInvoiceInput,
  type SupplyInvoiceLineInput,
  type SupplyItemEditInput,
  type SupplyItemInput,
  type SupplyReceiveInput,
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

// ================= Счета =================

const invoiceLineRow = (line: SupplyInvoiceLineInput) => ({
  line_no: line.lineNo,
  name: line.name,
  unit: line.unit,
  quantity: line.quantity,
  request_item_id: line.requestItemId,
});

export async function createSupplyInvoiceAction(
  projectId: string,
  requestId: string,
  input: SupplyInvoiceInput,
  lines: SupplyInvoiceLineInput[],
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const header = supplyInvoiceSchema.safeParse(input);
  if (!header.success) return invalid(header.error);
  const parsedLines = lines.length === 0 ? { success: true as const, data: [] } : supplyInvoiceLinesSchema.safeParse(lines);
  if (!parsedLines.success) return invalid(parsedLines.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_supply_invoice", {
    p_request_id: requestId,
    p_number: header.data.number,
    p_invoice_date: header.data.invoiceDate,
    p_supplier: header.data.supplier,
    // null у необязательных аргументов RPC: сгенерированный тип их не допускает.
    p_amount: header.data.amount as number,
    p_paid_on: header.data.paidOn as string,
    p_lines: parsedLines.data.map(invoiceLineRow),
  });

  if (error) return failed("createSupplyInvoiceAction", error);
  revalidateSupply(projectId);
  return { ok: true };
}

export async function updateSupplyInvoiceAction(
  projectId: string,
  invoiceId: string,
  input: SupplyInvoiceInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyInvoiceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const result = await supabase
    .from("supply_invoices")
    .update({
      number: parsed.data.number,
      invoice_date: parsed.data.invoiceDate,
      supplier: parsed.data.supplier,
      amount: parsed.data.amount,
      paid_on: parsed.data.paidOn,
    })
    .eq("id", invoiceId)
    .eq("project_id", projectId)
    .select("id");

  return affected("updateSupplyInvoiceAction", projectId, result);
}

export async function setSupplyInvoicePaidAction(
  projectId: string,
  invoiceId: string,
  paidOn: string | null,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyInvoiceSchema.shape.paidOn.safeParse(paidOn);
  if (!parsed.success) return { ok: false, error: "Укажите дату оплаты." };

  const supabase = await createClient();
  const result = await supabase
    .from("supply_invoices")
    .update({ paid_on: parsed.data })
    .eq("id", invoiceId)
    .eq("project_id", projectId)
    .select("id");

  return affected("setSupplyInvoicePaidAction", projectId, result);
}

export async function deleteSupplyInvoiceAction(projectId: string, invoiceId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyInvoiceAction", projectId, result);
}

/** Строки в существующий счёт; requestId чужой заявки отвергнет FK (invoice_id, request_id). */
export async function addSupplyInvoiceLinesAction(
  projectId: string,
  requestId: string,
  invoiceId: string,
  lines: SupplyInvoiceLineInput[],
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyInvoiceLinesSchema.safeParse(lines);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("supply_invoice_lines").insert(
    parsed.data.map((line) => ({
      ...invoiceLineRow(line),
      project_id: projectId,
      request_id: requestId,
      invoice_id: invoiceId,
    })),
  );

  if (error) return failed("addSupplyInvoiceLinesAction", error);
  revalidateSupply(projectId);
  return { ok: true };
}

export async function updateSupplyInvoiceLineAction(
  projectId: string,
  lineId: string,
  input: SupplyInvoiceLineInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyInvoiceLineSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const result = await supabase
    .from("supply_invoice_lines")
    .update(invoiceLineRow(parsed.data))
    .eq("id", lineId)
    .eq("project_id", projectId)
    .select("id");

  return affected("updateSupplyInvoiceLineAction", projectId, result);
}

export async function deleteSupplyInvoiceLineAction(projectId: string, lineId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_invoice_lines")
    .delete()
    .eq("id", lineId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyInvoiceLineAction", projectId, result);
}

// ================= Поставки (УПД) =================

export async function createSupplyDeliveryAction(
  projectId: string,
  invoiceId: string,
  input: SupplyDeliveryInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyDeliverySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_supply_delivery", {
    p_invoice_id: invoiceId,
    p_number: parsed.data.number,
    p_delivery_date: parsed.data.deliveryDate,
    p_lines: parsed.data.lines.map((l) => ({ invoice_line_id: l.invoiceLineId, quantity: l.quantity })),
  });

  if (error) return failed("createSupplyDeliveryAction", error);
  revalidateSupply(projectId);
  return { ok: true };
}

export async function updateSupplyDeliveryLineAction(
  projectId: string,
  deliveryLineId: string,
  quantity: number | string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = positiveQuantity.safeParse(quantity);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_FORM };

  const supabase = await createClient();
  const result = await supabase
    .from("supply_delivery_lines")
    .update({ quantity: parsed.data })
    .eq("id", deliveryLineId)
    .eq("project_id", projectId)
    .select("id");

  return affected("updateSupplyDeliveryLineAction", projectId, result);
}

export async function deleteSupplyDeliveryLineAction(projectId: string, deliveryLineId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_delivery_lines")
    .delete()
    .eq("id", deliveryLineId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyDeliveryLineAction", projectId, result);
}

export async function deleteSupplyDeliveryAction(projectId: string, deliveryId: string): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const result = await supabase
    .from("supply_deliveries")
    .delete()
    .eq("id", deliveryId)
    .eq("project_id", projectId)
    .select("id");

  return affected("deleteSupplyDeliveryAction", projectId, result);
}

// ================= Оприходование на остаток =================

export async function receiveSupplyDeliveryLineAction(
  projectId: string,
  deliveryLineId: string,
  input: SupplyReceiveInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = supplyReceiveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_supply_delivery_line", {
    p_delivery_line_id: deliveryLineId,
    p_material_id: parsed.data.materialId,
    p_quantity: parsed.data.quantity,
    p_note: parsed.data.note ?? "",
  });

  if (error) return failed("receiveSupplyDeliveryLineAction", error);
  revalidateSupply(projectId);
  // Остаток вырос — обновить и «Материалы» (вместе со страницами материалов).
  revalidatePath(`/${projectId}/materials`, "layout");
  return { ok: true };
}

/** Материал справочника прямо из окна оприходования; минимальный остаток — 0. */
export async function createSupplyMaterialAction(
  projectId: string,
  input: { name: string; unit: string },
): Promise<{ ok: true; materialId: string } | { ok: false; error: string }> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return { ok: false, error: denied.ok ? "" : denied.error };

  const parsed = materialSchema.safeParse({ ...input, minimumBalance: 0 });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_FORM };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .insert({ project_id: projectId, name: parsed.data.name, unit: parsed.data.unit, minimum_balance: 0 })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Материал с таким названием уже есть." };
    console.error("createSupplyMaterialAction:", error);
    return { ok: false, error: "Не удалось добавить материал. Попробуйте ещё раз." };
  }

  revalidateSupply(projectId);
  revalidatePath(`/${projectId}/materials`, "layout");
  return { ok: true, materialId: data.id };
}
