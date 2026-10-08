"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { returnTaskToBacklogAction } from "@/app/(app)/[projectId]/board/actions";
import { Button } from "@/components/ui/button";
import { canReturnToBacklog } from "@/lib/business/task-planning";
import type { TaskStatus } from "@/lib/business/task-status";

/**
 * Снять задачу с плана — то же, что перетаскивание в «Текущие заявки» на доске
 * (public.return_task_to_backlog): у начатой задачи прошедшие дни остаются историей.
 */
export function ReturnToBacklogButton({
  projectId,
  taskId,
  plannedDate,
  status,
}: {
  projectId: string;
  taskId: string;
  plannedDate: string | null;
  status: TaskStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!plannedDate || !canReturnToBacklog(status)) {
    return null;
  }

  const onClick = () => {
    startTransition(async () => {
      const result = await returnTaskToBacklogAction(projectId, taskId);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Заявка снята с плана.");
        router.refresh();
      }
    });
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
      Вернуть в «Текущие заявки»
    </Button>
  );
}
