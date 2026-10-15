"use client";

import type { ReactNode } from "react";

import { CheckIcon, ChevronDownIcon } from "@/components/common/icons";
import { cn } from "@/lib/utils";

/**
 * Стопка «Сделано» внизу дня: свёрнутая строка-кнопка с «краями листов»,
 * по нажатию показывает карточки (children). Раскрытием управляет колонка дня
 * (ей нужно знать, какие карточки в SortableContext). Строка не перетаскивается
 * и не сортируется.
 */
export function DoneStack({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const edges = Math.min(2, count - 1);

  return (
    <>
      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Сделано: ${count}. ${open ? "Скрыть" : "Показать"}`}
          onClick={onToggle}
          className="flex h-[30px] w-full items-center gap-1.5 rounded-[7px] border border-line-subtle bg-surface px-2.5 text-[11.5px] text-meta transition-colors duration-120 hover:border-line-strong focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 focus-visible:outline-none"
        >
          <CheckIcon size={12} />
          <span className="font-medium">Сделано · {count}</span>
          <ChevronDownIcon
            size={12}
            className={cn("ml-auto transition-transform", open && "rotate-180")}
          />
        </button>
        {!open
          ? Array.from({ length: edges }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="h-[5px] rounded-b-[5px] border border-t-0 border-line-subtle bg-surface"
                style={{
                  marginInline: 4 * (i + 1),
                  marginTop: i === 0 ? -1 : 0,
                }}
              />
            ))
          : null}
      </div>
      {open ? children : null}
    </>
  );
}
