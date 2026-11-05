// Статусы снабжения вычисляются из строк счетов и поставок, а не хранятся
// (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §5): «зелёной»
// не может оказаться позиция, которую на самом деле не привезли.
//
// Количество заявки и счёта не сравниваются — единицы разные («шт» и «упак»).
// Позиция привезена, когда привезены все привязанные к ней строки счетов.

import type { SupplyInvoiceLineView, SupplyRequestView } from "@/lib/types/supply";

export type SupplyLineState = "none" | "partial" | "full";
export type SupplyItemStatus = "cancelled" | "no_invoice" | "delivered" | "partial" | "paid" | "unpaid";

export interface SupplyLineProgress {
  state: SupplyLineState;
  delivered: number;
  over: boolean;
}

export interface SupplyRequestSummary {
  status: "active" | "delivered";
  /** Счётчики — по неснятым позициям. */
  total: number;
  invoiced: number;
  paid: number;
  delivered: number;
  items: Record<string, SupplyItemStatus>;
  lines: Record<string, SupplyLineProgress>;
}

// numeric(14, 3): считаем в тысячных, чтобы 0.1 + 0.2 было ровно 0.3.
const toMilli = (value: number) => Math.round(value * 1000);

export function lineProgress(line: SupplyInvoiceLineView): SupplyLineProgress {
  const deliveredMilli = line.deliveries.reduce((sum, d) => sum + toMilli(d.quantity), 0);
  const quantityMilli = toMilli(line.quantity);
  const state: SupplyLineState =
    deliveredMilli === 0 ? "none" : deliveredMilli < quantityMilli ? "partial" : "full";
  return { state, delivered: deliveredMilli / 1000, over: deliveredMilli > quantityMilli };
}

/** Сколько ещё ждать по строке счёта; у перепоставленной строки — 0. */
export function remainingToDeliver(line: SupplyInvoiceLineView): number {
  return Math.max(0, toMilli(line.quantity) - toMilli(lineProgress(line).delivered)) / 1000;
}

export function summarizeRequest(request: SupplyRequestView): SupplyRequestSummary {
  const lines: Record<string, SupplyLineProgress> = {};
  const byItem = new Map<string, { progress: SupplyLineProgress; paid: boolean }[]>();

  for (const invoice of request.invoices) {
    for (const line of invoice.lines) {
      const progress = lineProgress(line);
      lines[line.id] = progress;
      if (line.requestItemId === null) continue;
      const linked = byItem.get(line.requestItemId) ?? [];
      linked.push({ progress, paid: invoice.paidOn !== null });
      byItem.set(line.requestItemId, linked);
    }
  }

  const items: Record<string, SupplyItemStatus> = {};
  let total = 0;
  let invoiced = 0;
  let paid = 0;
  let delivered = 0;

  for (const item of request.items) {
    const linked = byItem.get(item.id) ?? [];
    const status = itemStatus(item.cancelled, linked);
    items[item.id] = status;
    if (status === "cancelled") continue;

    total += 1;
    if (linked.length > 0) invoiced += 1;
    if (linked.length > 0 && linked.every((l) => l.paid)) paid += 1;
    if (status === "delivered") delivered += 1;
  }

  return {
    status: total > 0 && delivered === total ? "delivered" : "active",
    total,
    invoiced,
    paid,
    delivered,
    items,
    lines,
  };
}

function itemStatus(
  cancelled: boolean,
  linked: { progress: SupplyLineProgress; paid: boolean }[],
): SupplyItemStatus {
  if (cancelled) return "cancelled";
  if (linked.length === 0) return "no_invoice";
  if (linked.every((l) => l.progress.state === "full")) return "delivered";
  if (linked.some((l) => l.progress.state !== "none")) return "partial";
  return linked.every((l) => l.paid) ? "paid" : "unpaid";
}

/**
 * Порядок показа позиций в таблице заявки: сверху то, что ещё не привезли.
 *
 * Мастер открывает заявку, чтобы понять, чего не хватает, — искать непривезённое
 * в середине документа по номерам строк неудобно. Внутри группы порядок остаётся
 * документным (по номеру строки), чтобы соседние позиции не разъезжались.
 *
 * `no_invoice` — первым: по позиции ещё даже не заказано, это самое «горячее».
 * `cancelled` — в самый низ: снятая позиция не требует действий.
 */
const ITEM_ORDER: Record<SupplyItemStatus, number> = {
  no_invoice: 0,
  unpaid: 1,
  paid: 2,
  partial: 3,
  delivered: 4,
  cancelled: 5,
};

/** Место статуса в порядке показа (0 — наверху). Неизвестный статус — как «не привезено». */
export function itemOrderRank(status: SupplyItemStatus | undefined): number {
  return status ? ITEM_ORDER[status] : 1;
}

/** Позиции заявки в порядке показа: группы по статусу, внутри — по номеру строки. */
export function sortItemsForView<T extends { id: string; lineNo: number }>(
  items: readonly T[],
  statuses: Record<string, SupplyItemStatus | undefined>,
): T[] {
  return [...items].sort((a, b) => {
    const byStatus = itemOrderRank(statuses[a.id]) - itemOrderRank(statuses[b.id]);
    return byStatus !== 0 ? byStatus : a.lineNo - b.lineNo;
  });
}
