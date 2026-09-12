"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/business/dates";
import { canCarryOverTask } from "@/lib/business/task-planning";
import type { TaskStatus } from "@/lib/business/task-status";
import { nextWorkingDay } from "@/lib/business/working-days";

import { carryOverTaskAction } from "./actions";

export function CarryOverButton({
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

  if (!plannedDate || !canCarryOverTask(status)) {
    return null;
  }

  const nextDate = nextWorkingDay(plannedDate);

  const onClick = () => {
    startTransition(async () => {
      const result = await carryOverTaskAction(projectId, taskId);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Перенесено.");
        router.refresh();
      }
    });
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
      Перенести на следующий рабочий день ({formatDateLong(nextDate)})
    </Button>
  );
}
