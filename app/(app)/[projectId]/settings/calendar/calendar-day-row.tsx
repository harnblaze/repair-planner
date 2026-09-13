"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { BADGE_BASE } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/business/dates";
import { weekdayLabel, type CalendarDayKind } from "@/lib/business/working-days";
import { cn } from "@/lib/utils";

import { deleteCalendarDayAction } from "./actions";

const KIND_BADGE: Record<CalendarDayKind, { label: string; className: string }> = {
  holiday: { label: "Нерабочий", className: "bg-status-warn-bg text-status-warn-fg" },
  working_day: { label: "Рабочая суббота", className: "bg-status-progress-bg text-status-progress-fg" },
};

type CalendarDayRowData = { id: string; day: string; kind: CalendarDayKind; name: string | null };

export function CalendarDayRow({
  projectId,
  calendarDay,
  canEdit,
}: {
  projectId: string;
  calendarDay: CalendarDayRowData;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const badge = KIND_BADGE[calendarDay.kind];

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteCalendarDayAction(projectId, calendarDay.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "День удалён из календаря.");
      }
    });
  };

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[112px] flex-none text-[12.5px] text-ink">
        {formatDateLong(calendarDay.day)}
        <span className="ml-1 text-meta">{weekdayLabel(calendarDay.day).toLowerCase()}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className={cn(BADGE_BASE, badge.className)}>{badge.label}</span>
        {calendarDay.name ? (
          <span className="max-w-full truncate text-[12px] text-ink-muted">{calendarDay.name}</span>
        ) : null}
      </div>
      {canEdit ? (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
          Удалить
        </Button>
      ) : null}
    </div>
  );
}
