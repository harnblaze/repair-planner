"use client";

import { PencilIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateShort } from "@/lib/business/dates";
import type { SupplyInvoiceView, SupplyRequestView } from "@/lib/types/supply";

import { formatMoney } from "./format";

// Строки «Счета» и «Поставки» под таблицей заявки (спека §6.1).

export interface InvoiceActions {
  onEdit: (invoice: SupplyInvoiceView) => void;
  onPaid: (invoice: SupplyInvoiceView) => void;
  onAddLines: (invoice: SupplyInvoiceView) => void;
}

export function InvoicesList({
  request,
  actions,
}: {
  request: SupplyRequestView;
  /** Нет — только просмотр. */
  actions?: InvoiceActions;
}) {
  if (request.invoices.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <span className="text-[11px] font-semibold text-ink-header">Счета</span>
      {request.invoices.map((invoice) => (
        <div key={invoice.id} data-invoice-id={invoice.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-ink">№{invoice.number}</span>
          <span className="text-meta">от {formatDateShort(invoice.invoiceDate)}</span>
          <span className="text-ink-soft">{invoice.supplier}</span>
          {invoice.amount !== null && <span className="tabular-nums text-ink-soft">{formatMoney(invoice.amount)}</span>}
          {invoice.paidOn ? (
            <span className="font-medium text-status-done-fg">✓ оплачен {formatDateShort(invoice.paidOn)}</span>
          ) : (
            <span className="rounded-[4px] bg-status-alert-bg px-1.5 py-0.5 text-[11px] font-semibold text-status-alert-fg">
              не оплачен
            </span>
          )}
          {actions && (
            <>
              {!invoice.paidOn && (
                <Button type="button" variant="outline" size="xs" onClick={() => actions.onPaid(invoice)}>
                  Оплачен…
                </Button>
              )}
              {invoice.paidOn && (
                <Button type="button" variant="ghost" size="xs" onClick={() => actions.onPaid(invoice)}>
                  Дата оплаты
                </Button>
              )}
              <Button type="button" variant="ghost" size="xs" onClick={() => actions.onAddLines(invoice)}>
                <PlusIcon />
                Строки
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Изменить счёт №${invoice.number}`}
                onClick={() => actions.onEdit(invoice)}
              >
                <PencilIcon />
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
