import Link from "next/link";

import { taskStatusLabel, type TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

export type BoardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  categoryName: string | null;
  executorNames: string[];
  // Заполняется, когда этот день — не последний день работы над задачей:
  // задача была перенесена дальше (product-requirements.md §4.3).
  transferNote?: string | null;
};

export function TaskChip({ projectId, task }: { projectId: string; task: BoardTask }) {
  const meta = [task.categoryName, taskStatusLabel(task.status), ...task.executorNames]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/${projectId}/tasks/${task.id}`}
      className={cn(
        "block border-b border-border/60 py-1.5 text-sm hover:bg-muted",
        task.transferNote ? "opacity-60" : undefined,
      )}
    >
      <p className="leading-snug">{task.title}</p>
      {meta ? <p className="text-xs text-muted-foreground leading-snug">{meta}</p> : null}
      {task.transferNote ? (
        <p className="text-xs italic text-muted-foreground leading-snug">{task.transferNote}</p>
      ) : null}
    </Link>
  );
}
