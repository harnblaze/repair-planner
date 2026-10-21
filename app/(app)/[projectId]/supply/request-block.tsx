"use client";

import type { ReactNode } from "react";

import { ChevronDownIcon } from "@/components/common/icons";
import type { SupplyRequestSummary } from "@/lib/business/supply-status";
import type { SupplyRequestView } from "@/lib/types/supply";
import { cn } from "@/lib/utils";

import { formatDocDate } from "./format";
import { RequestTable, type RequestTableSlots } from "./request-table";

// Сворачиваемый блок заявки на ТМЦ (спека §6.1): шапка со счётчиками,
// действия, счета и поставки, под ними — таблица позиций и счетов.

export function RequestBlock({
  request,
  summary,
  open,
  onToggle,
  menu,
  documents,
  ...tableSlots
}: {
  request: SupplyRequestView;
  summary: SupplyRequestSummary;
  open: boolean;
  onToggle: () => void;
  /** Меню действий заявки в шапке (только при праве редактирования). */
  menu?: ReactNode;
  /** Кнопки действий, строки «Счета» и «Поставки» — над таблицей. */
  documents?: ReactNode;
} & RequestTableSlots) {
  const delivered = summary.status === "delivered";

  return (
    <section
      data-request-id={request.id}
      className={cn(
        "rounded-[10px] border bg-surface",
        delivered ? "border-status-done-fg/25" : "border-line-card",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-[10px] px-3 py-2",
          delivered && "bg-status-done-bg",
          !open && "rounded-b-[10px]",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          // basis 14rem: на узком экране сводка переносится под номер, а не налезает на него.
          className="flex min-w-0 flex-[1_1_14rem] cursor-pointer items-center gap-2 text-left"
        >
          <ChevronDownIcon className={cn("flex-none text-meta-dim transition-transform", !open && "-rotate-90")} />
          <span className="text-[13px] font-semibold text-ink">№{request.number}</span>
          <span className="text-[12px] text-meta">{formatDocDate(request.requestDate)}</span>
          {request.description && <span className="min-w-0 truncate text-[12.5px] text-ink-soft">{request.description}</span>}
        </button>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-meta">
          {delivered ? (
            <span className="font-semibold text-status-done-fg">привезена целиком ✓</span>
          ) : (
            <>
              <span>
                в счетах {summary.invoiced}/{summary.total}
              </span>
              <span>
                оплачено {summary.paid}/{summary.total}
              </span>
              <span>
                привезено {summary.delivered}/{summary.total}
              </span>
            </>
          )}
          {menu}
        </div>
      </header>

      {open && (
        <div className="flex flex-col gap-2 px-1 pb-3">
          {documents && <div className="flex flex-col gap-1.5 px-2 pt-1 empty:hidden">{documents}</div>}
          {request.items.length === 0 && request.invoices.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-faint">В заявке пока нет позиций.</p>
          ) : (
            <RequestTable request={request} summary={summary} {...tableSlots} />
          )}
        </div>
      )}
    </section>
  );
}
