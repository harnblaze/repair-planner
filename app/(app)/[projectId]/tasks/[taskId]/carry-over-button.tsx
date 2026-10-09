"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDateWithWeekday } from "@/lib/business/dates";
import { canCarryOverTask } from "@/lib/business/task-planning";
import type { TaskStatus } from "@/lib/business/task-status";

import { carryOverTaskAction } from "./actions";
import { toastCarriedOver } from "./undo-carry-over";

export function CarryOverButton({
  projectId,
  taskId,
  plannedDate,
  nextDate,
  status,
}: {
  projectId: string;
  taskId: string;
  plannedDate: string | null;
  /** Следующий рабочий день по календарю проекта — только подпись; перенос считает БД. */
  nextDate: string | null;
  status: TaskStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!plannedDate || !canCarryOverTask(status)) {
    return null;
  }

  const onClick = () => {
    startTransition(async () => {
      const result = await carryOverTaskAction(projectId, taskId);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toastCarriedOver(result.message ?? "Перенесено.", projectId, taskId, () => router.refresh());
        router.refresh();
      }
    });
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
      {nextDate ? `Перенести на ${formatDateWithWeekday(nextDate)}` : "Перенести на следующий рабочий день"}
    </Button>
  );
}
