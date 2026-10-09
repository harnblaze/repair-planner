"use client";

import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countNeedingRestock, filterMaterials } from "@/lib/business/material-stock";
import { cn } from "@/lib/utils";

import { CreateMaterialForm } from "./create-material-form";
import { MATERIAL_ROW_GRID, MaterialRow, type Material } from "./material-row";

export function MaterialsList({
  projectId,
  materials,
  canEdit,
}: {
  projectId: string;
  /** Отсортированы по названию на сервере. */
  materials: Material[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [onlyRestock, setOnlyRestock] = useState(false);
  const [creating, setCreating] = useState(false);

  const active = materials.filter((m) => m.is_active);
  const inactive = materials.filter((m) => !m.is_active);
  const restockCount = countNeedingRestock(active);

  const shownActive = filterMaterials(active, { query, onlyRestock });
  // Неактивные не заказывают — при фильтре «Мало» их не показываем.
  const shownInactive = onlyRestock ? [] : filterMaterials(inactive, { query, onlyRestock: false });
  const filtering = query.trim() !== "" || onlyRestock;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[15px] font-semibold text-ink">
          Материалы
          {active.length > 0 ? <span className="font-normal text-counter"> {active.length}</span> : null}
        </h1>
        {canEdit && !creating ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon />
            Материал
          </Button>
        ) : null}
      </div>

      {canEdit && creating ? <CreateMaterialForm projectId={projectId} onClose={() => setCreating(false)} /> : null}

      {materials.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-meta-dim"
            />
            <Input
              type="search"
              aria-label="Поиск по названию"
              placeholder="Поиск по названию"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div role="group" aria-label="Показать" className="flex overflow-hidden rounded-[7px] border border-control">
            <FilterButton active={!onlyRestock} onClick={() => setOnlyRestock(false)}>
              Все <span className="text-counter">{active.length}</span>
            </FilterButton>
            <FilterButton active={onlyRestock} onClick={() => setOnlyRestock(true)}>
              Мало{" "}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] leading-[18px]",
                  restockCount > 0 ? "bg-status-warn-bg text-status-warn-fg" : "text-counter",
                )}
              >
                {restockCount}
              </span>
            </FilterButton>
          </div>
        </div>
      ) : null}

      <div>
        {shownActive.length > 0 ? (
          <div
            aria-hidden
            className={cn(
              "hidden border-b border-line-strong pb-1.5 text-[11px] font-medium text-meta",
              MATERIAL_ROW_GRID,
            )}
          >
            <span>Название</span>
            <span className="text-right">Остаток</span>
            <span className="text-right">Мин.</span>
          </div>
        ) : null}

        <div className="flex flex-col divide-y divide-line-subtle">
          {shownActive.length === 0 ? (
            <EmptyState>
              {materials.length === 0
                ? "Пока нет ни одного материала."
                : onlyRestock && query.trim() === ""
                  ? "Все остатки выше минимума."
                  : filtering
                    ? "Ничего не найдено."
                    : "Активных материалов нет."}
            </EmptyState>
          ) : (
            shownActive.map((material) => (
              <MaterialRow key={material.id} projectId={projectId} material={material} canEdit={canEdit} />
            ))
          )}
        </div>
      </div>

      {shownInactive.length > 0 ? (
        <details className="border-t border-line-subtle pt-2">
          <summary className="cursor-pointer text-[12px] text-meta">Неактивные ({shownInactive.length})</summary>
          <div className="flex flex-col divide-y divide-line-subtle pt-1">
            {shownInactive.map((material) => (
              <MaterialRow key={material.id} projectId={projectId} material={material} canEdit={canEdit} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-[28px] items-center gap-1.5 px-3 text-[12px] transition-colors not-first:border-l not-first:border-control",
        active ? "bg-brand-surface font-semibold text-brand" : "text-ink-soft hover:bg-row-hover",
      )}
    >
      {children}
    </button>
  );
}
