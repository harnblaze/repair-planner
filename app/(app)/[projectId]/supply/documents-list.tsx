"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateShort } from "@/lib/business/dates";
import type {
  SupplyDeliveryLineView,
  SupplyDeliveryView,
  SupplyInvoiceLineView,
  SupplyInvoiceView,
  SupplyRequestView,
} from "@/lib/types/supply";

import { formatMoney, formatQuantity } from "./format";

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

export function DeliveriesList({
  request,
  onEdit,
  onDelete,
}: {
  request: SupplyRequestView;
  /** Нет — только просмотр. */
  onEdit?: (delivery: SupplyDeliveryView) => void;
  onDelete?: (delivery: SupplyDeliveryView) => void;
}) {
  if (request.deliveries.length === 0) return null;
  const invoiceNumber = new Map(request.invoices.map((i) => [i.id, i.number]));

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <span className="text-[11px] font-semibold text-ink-header">Поставки</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {request.deliveries.map((delivery) => (
          <span key={delivery.id} className="inline-flex items-center gap-1.5">
            <span className="font-medium text-ink">УПД №{delivery.number}</span>
            <span className="text-meta">
              от {formatDateShort(delivery.deliveryDate)} · счёт №{invoiceNumber.get(delivery.invoiceId)}
            </span>
            {onEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Изменить поставку УПД №${delivery.number}`}
                onClick={() => onEdit(delivery)}
              >
                <PencilIcon />
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Удалить поставку УПД №${delivery.number}`}
                onClick={() => onDelete(delivery)}
              >
                <Trash2Icon />
              </Button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Поставки строки счёта в ячейке «Привезено»: УПД, кол-во, оприходование. */
export function LineDeliveries({
  line,
  deliveries,
  onEdit,
  onReceive,
}: {
  line: SupplyInvoiceLineView;
  deliveries: Map<string, SupplyDeliveryView>;
  /** Нет — только просмотр. */
  onEdit?: (deliveryLine: SupplyDeliveryLineView, delivery: SupplyDeliveryView) => void;
  onReceive?: (deliveryLine: SupplyDeliveryLineView, delivery: SupplyDeliveryView) => void;
}) {
  if (line.deliveries.length === 0) return null;

  return (
    <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-meta">
      {line.deliveries.map((dl) => {
        const delivery = deliveries.get(dl.deliveryId);
        if (!delivery) return null;
        const label = `${formatQuantity(dl.quantity)} · УПД ${delivery.number} ${formatDateShort(delivery.deliveryDate)}`;
        return (
          <li key={dl.id} className="flex flex-wrap items-center gap-1.5" data-delivery-line-id={dl.id}>
            {onEdit && !dl.received ? (
              <button type="button" className="cursor-pointer hover:underline" onClick={() => onEdit(dl, delivery)}>
                {label}
              </button>
            ) : (
              <span>{label}</span>
            )}
            {dl.received ? (
              <span className="font-medium text-status-done-fg">✓ оприходовано</span>
            ) : (
              onReceive && (
                <Button type="button" variant="outline" size="xs" onClick={() => onReceive(dl, delivery)}>
                  Оприходовать
                </Button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
