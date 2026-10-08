import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { formatDateNumeric } from "@/lib/business/dates";
import { formatQuantity } from "@/lib/business/material-report";
import { cn } from "@/lib/utils";
import { ARCHIVE_MAX_PAGE, archiveQuery, hasArchiveFilters, type ArchiveFilters } from "@/lib/validation/archive-filters";

import type { ArchiveResult } from "./archive-data";

export function ArchiveList({
  projectId,
  filters,
  result,
  timezone,
  material,
}: {
  projectId: string;
  filters: ArchiveFilters;
  result: ArchiveResult;
  timezone: string;
  /** Материал фильтра: в строке показывается его расход. */
  material: { name: string; unit: string } | null;
}) {
  if (!result.ok) {
    return (
      <p role="alert" className="text-[12.5px] text-status-alert-fg">
        Не удалось загрузить архив. Обновите страницу.
      </p>
    );
  }

  if (result.tasks.length === 0) {
    return (
      <EmptyState>
        {hasArchiveFilters(filters) ? "Ничего не найдено. Измените условия поиска." : "Выполненных заявок пока нет."}
      </EmptyState>
    );
  }

  const base = `/${projectId}/tasks`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col divide-y divide-line-subtle">
        {result.tasks.map((task) => {
          const meta = [task.categoryName, ...task.executorNames].filter(Boolean).join(" · ");
          const cancelled = task.status === "cancelled";
          return (
            <Link
              key={task.id}
              href={`${base}/${task.id}`}
              className="flex items-start justify-between gap-3 py-2 hover:bg-row-hover"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("break-words", cancelled && "text-meta line-through")}>{task.title}</span>
                {meta ? <span className="text-[12px] break-words text-meta">{meta}</span> : null}
                {material && task.materialQuantity !== null ? (
                  <span className="text-[12px] break-words text-ink">
                    {material.name} — {formatQuantity(task.materialQuantity)} {material.unit}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[12px] text-meta">
                {task.completedAt
                  ? formatDateNumeric(task.completedAt, timezone)
                  : task.cancelledAt
                    ? `Отменена ${formatDateNumeric(task.cancelledAt, timezone)}`
                    : "Отменена"}
              </span>
            </Link>
          );
        })}
      </div>
      {result.hasMore ? (
        filters.page < ARCHIVE_MAX_PAGE ? (
          <Link
            href={`${base}?${archiveQuery(filters, { page: filters.page + 1 })}`}
            scroll={false}
            className="self-start text-[12.5px] text-meta transition-colors duration-120 hover:text-ink"
          >
            Показать ещё
          </Link>
        ) : (
          <p className="text-[12px] text-meta-dim">Уточните условия поиска</p>
        )
      ) : null}
    </div>
  );
}
