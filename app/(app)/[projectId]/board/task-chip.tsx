import Link from "next/link";

import { taskStatusLabel, type TaskStatus } from "@/lib/business/task-status";

export type BoardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  categoryName: string | null;
  executorNames: string[];
};

export function TaskChip({ projectId, task }: { projectId: string; task: BoardTask }) {
  const meta = [task.categoryName, taskStatusLabel(task.status), ...task.executorNames]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/${projectId}/tasks/${task.id}`}
      className="block border-b border-border/60 py-1.5 text-sm hover:bg-muted"
    >
      <p className="leading-snug">{task.title}</p>
      {meta ? <p className="text-xs text-muted-foreground leading-snug">{meta}</p> : null}
    </Link>
  );
}
