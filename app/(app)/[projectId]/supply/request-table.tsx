"use client";

import type { ReactNode } from "react";

import { formatDateShort } from "@/lib/business/dates";
import type { SupplyItemStatus, SupplyLineProgress, SupplyRequestSummary } from "@/lib/business/supply-status";
import type { SupplyInvoiceLineView, SupplyInvoiceView, SupplyItemView, SupplyRequestView } from "@/lib/types/supply";
import { cn } from "@/lib/utils";

import { formatQuantity } from "./format";

// Таблица заявки (спека §6.1): слева позиция заявки, справа строки счетов,
// привязанные к ней. Позиция с несколькими строками — левая часть объединена.

const ROW_CLASSES: Partial<Record<SupplyItemStatus, string>> = {
  delivered: "bg-status-done-bg",
  partial: "bg-status-done-bg/45",
};

const CELL = "border-t border-line-subtle px-2 py-1.5 align-top";
const NUM = "text-right tabular-nums whitespace-nowrap";

export interface RequestTableSlots {
  /** Клик по позиции заявки (правка) — только при праве редактирования. */
  onItemClick?: (item: SupplyItemView) => void;
  /** Клик по строке счёта (правка). */
  onLineClick?: (line: SupplyInvoiceLineView) => void;
  /** Содержимое ячейки «Привезено» поверх сводки (поставки, оприходование). */
  renderDeliveries?: (line: SupplyInvoiceLineView) => ReactNode;
}

export function RequestTable({
  request,
  summary,
  onItemClick,
  onLineClick,
  renderDeliveries,
}: { request: SupplyRequestView; summary: SupplyRequestSummary } & RequestTableSlots) {
  const invoiceById = new Map(request.invoices.map((i) => [i.id, i]));
  const linesByItem = new Map<string, SupplyInvoiceLineView[]>();
  const offRequest: SupplyInvoiceLineView[] = [];

  for (const invoice of request.invoices) {
    for (const line of invoice.lines) {
      if (line.requestItemId === null) {
        offRequest.push(line);
        continue;
      }
      const list = linesByItem.get(line.requestItemId) ?? [];
      list.push(line);
      linesByItem.set(line.requestItemId, list);
    }
  }

  const lineCells = (line: SupplyInvoiceLineView) => {
    const invoice = invoiceById.get(line.invoiceId) as SupplyInvoiceView;
    const progress = summary.lines[line.id];
    return (
      <>
        <td className={cn(CELL, "whitespace-nowrap text-ink-muted")}>
          {invoice.number} · {formatDateShort(invoice.invoiceDate)}
        </td>
        <td className={cn(CELL, onLineClick && "cursor-pointer hover:underline")} onClick={() => onLineClick?.(line)}>
          {line.name}
        </td>
        <td className={cn(CELL, "whitespace-nowrap")}>{line.unit}</td>
        <td className={cn(CELL, NUM)}>{formatQuantity(line.quantity)}</td>
        <td className={cn(CELL, "whitespace-nowrap")}>
          {invoice.paidOn ? (
            <span className="font-medium text-status-done-fg">✓ {formatDateShort(invoice.paidOn)}</span>
          ) : (
            <span className="rounded-[4px] bg-status-alert-bg px-1.5 py-0.5 text-[11px] font-semibold text-status-alert-fg">
              не оплачен
            </span>
          )}
        </td>
        <td className={cn(CELL, "min-w-40")}>
          <DeliveredSummary quantity={line.quantity} progress={progress} />
          {renderDeliveries?.(line)}
        </td>
      </>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-[12px] text-ink">
        <thead>
          <tr className="text-left text-[11px] font-semibold text-ink-header">
            <th className="w-10 px-2 py-1.5">№</th>
            <th className="px-2 py-1.5">Материал (заявка)</th>
            <th className="px-2 py-1.5">Ед.</th>
            <th className="border-r border-line-strong px-2 py-1.5 text-right">Кол-во</th>
            <th className="px-2 py-1.5">Счёт</th>
            <th className="px-2 py-1.5">По счёту</th>
            <th className="px-2 py-1.5">Ед.</th>
            <th className="px-2 py-1.5 text-right">Кол-во</th>
            <th className="px-2 py-1.5">Оплата</th>
            <th className="px-2 py-1.5">Привезено</th>
          </tr>
        </thead>
        <tbody>
          {request.items.map((item) => {
            const status = summary.items[item.id];
            const lines = linesByItem.get(item.id) ?? [];
            const span = Math.max(1, lines.length);
            const left = (
              <>
                <td rowSpan={span} className={cn(CELL, NUM, "text-ink-muted")}>
                  {item.lineNo}
                </td>
                <td
                  rowSpan={span}
                  className={cn(CELL, onItemClick && "cursor-pointer hover:underline")}
                  onClick={() => onItemClick?.(item)}
                >
                  <span className={cn(status === "cancelled" && "text-faint line-through")}>{item.name}</span>
                  {status === "cancelled" && <span className="ml-1.5 text-[11px] text-faint">снята</span>}
                  {item.note && <div className="text-[11px] text-meta">{item.note}</div>}
                </td>
                <td rowSpan={span} className={cn(CELL, "whitespace-nowrap", status === "cancelled" && "text-faint")}>
                  {item.unit}
                </td>
                <td
                  rowSpan={span}
                  className={cn(CELL, NUM, "border-r border-line-strong", status === "cancelled" && "text-faint")}
                >
                  {formatQuantity(item.quantity)}
                </td>
              </>
            );

            if (lines.length === 0) {
              return (
                <tr key={item.id} data-status={status} className={ROW_CLASSES[status]}>
                  {left}
                  <td colSpan={6} className={cn(CELL, "text-center")}>
                    {status === "no_invoice" ? (
                      <span className="rounded-[4px] bg-status-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-status-warn-fg">
                        нет счёта
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            }

            return lines.map((line, index) => (
              <tr key={line.id} data-status={status} className={ROW_CLASSES[status]}>
                {index === 0 && left}
                {lineCells(line)}
              </tr>
            ));
          })}

          {offRequest.map((line, index) => (
            <tr key={line.id} data-status="off_request">
              {index === 0 && (
                <td rowSpan={offRequest.length} colSpan={4} className={cn(CELL, "border-r border-line-strong text-meta")}>
                  Вне заявки
                </td>
              )}
              {lineCells(line)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveredSummary({ quantity, progress }: { quantity: number; progress: SupplyLineProgress }) {
  const { delivered, over, state } = progress;
  if (state === "none") return <span className="text-faint">—</span>;
  if (over) {
    return (
      <span className="font-medium text-status-done-fg">
        привезено больше: {formatQuantity(delivered)} / {formatQuantity(quantity)}
      </span>
    );
  }
  if (state === "full") return <span className="font-medium text-status-done-fg">✓ {formatQuantity(delivered)}</span>;
  return (
    <span className="font-medium text-ink-soft">
      {formatQuantity(delivered)} / {formatQuantity(quantity)}
    </span>
  );
}
