import { taskStatusLabel, type TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

// Цвета бейджей заданы дизайном (docs/redesign.md §5 «Статусы»). Ключи —
// стабильные значения из БД, подписи по-прежнему берутся из taskStatusLabel.
const STATUS_CLASSES: Record<TaskStatus, string> = {
  new: "bg-brand-surface text-brand",
  planned: "bg-brand-surface text-brand",
  in_progress: "bg-status-progress-bg text-status-progress-fg",
  paused: "bg-status-warn-bg text-status-warn-fg",
  completed: "bg-status-done-bg text-status-done-fg",
  cancelled: "bg-status-alert-bg text-status-alert-fg",
};

export const BADGE_BASE =
  "inline-block max-w-full flex-none overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] px-1.5 py-1 text-[10.5px] font-semibold leading-none";

export function StatusBadge({
  status,
  muted = false,
  className,
}: {
  status: TaskStatus;
  /** Перенесённая задача: бейдж нейтрализуется, чтобы не спорить с текущим днём. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        BADGE_BASE,
        muted ? "bg-page text-meta-alt" : STATUS_CLASSES[status],
        className,
      )}
    >
      {taskStatusLabel(status)}
    </span>
  );
}
