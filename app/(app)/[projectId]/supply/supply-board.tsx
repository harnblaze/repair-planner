"use client";

import { useMemo, useState } from "react";

import { PencilIcon, PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterSupplyRequests } from "@/lib/business/supply-filter";
import { summarizeRequest } from "@/lib/business/supply-status";
import type { SupplyItemView, SupplyRequestView } from "@/lib/types/supply";
import { cn } from "@/lib/utils";

import { RequestBlock } from "./request-block";
import { ItemDialog, ItemsDialog, RequestDialog } from "./request-dialogs";
import type { SupplyMaterialOption } from "./supply-data";

export interface SupplyBoardProps {
  projectId: string;
  requests: SupplyRequestView[];
  materials: SupplyMaterialOption[];
  canEdit: boolean;
  today: string;
}

// Одно открытое окно на странице; данные окна — снимок на момент открытия.
type OpenDialog =
  | { kind: "request"; request: SupplyRequestView | null }
  | { kind: "items"; request: SupplyRequestView }
  | { kind: "item"; item: SupplyItemView };

export function SupplyBoard({ projectId, requests, materials, canEdit, today }: SupplyBoardProps) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  // Явно раскрытые/свёрнутые мастером; остальные — по умолчанию (§6.1).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const summaries = useMemo(() => new Map(requests.map((r) => [r.id, summarizeRequest(r)])), [requests]);
  const visible = useMemo(() => filterSupplyRequests(requests, { query, onlyActive }), [requests, query, onlyActive]);
  const searching = query.trim() !== "";

  const isOpen = (id: string) =>
    toggled[id] ?? (searching || summaries.get(id)?.status !== "delivered");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: номер, поставщик, материал…"
          aria-label="Поиск по заявкам на ТМЦ"
          className="max-w-sm flex-1"
        />
        <div role="radiogroup" aria-label="Какие заявки показывать" className="flex rounded-[7px] bg-page p-0.5">
          {[
            { value: true, label: "Активные" },
            { value: false, label: "Все" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={onlyActive === option.value}
              onClick={() => setOnlyActive(option.value)}
              className={cn(
                "h-[26px] cursor-pointer rounded-[6px] px-3 text-[12px] font-medium text-ink-nav",
                onlyActive === option.value && "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {canEdit && (
          <Button type="button" className="ml-auto" onClick={() => setDialog({ kind: "request", request: null })}>
            <PlusIcon />
            Заявка на ТМЦ
          </Button>
        )}
      </div>

      {requests.length === 0 ? (
        <EmptyState>Заявок на ТМЦ пока нет.</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>{searching ? "Ничего не найдено." : "Активных заявок нет — всё привезено."}</EmptyState>
      ) : (
        visible.map((request) => (
          <RequestBlock
            key={request.id}
            request={request}
            summary={summaries.get(request.id)!}
            open={isOpen(request.id)}
            onToggle={() => setToggled((t) => ({ ...t, [request.id]: !isOpen(request.id) }))}
            onItemClick={canEdit ? (item) => setDialog({ kind: "item", item }) : undefined}
            menu={
              canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Изменить заявку №${request.number}`}
                  onClick={() => setDialog({ kind: "request", request })}
                >
                  <PencilIcon />
                </Button>
              )
            }
            footer={
              canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ kind: "items", request })}>
                    <PlusIcon />
                    Позиции
                  </Button>
                </div>
              )
            }
          />
        ))
      )}

      {dialog?.kind === "request" && (
        <RequestDialog projectId={projectId} today={today} request={dialog.request} onClose={closeDialog} />
      )}
      {dialog?.kind === "items" && <ItemsDialog projectId={projectId} request={dialog.request} onClose={closeDialog} />}
      {dialog?.kind === "item" && (
        <ItemDialog projectId={projectId} item={dialog.item} materials={materials} onClose={closeDialog} />
      )}
    </div>
  );
}
