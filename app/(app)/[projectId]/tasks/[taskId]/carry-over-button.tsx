"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!plannedDate || !canCarryOverTask(status)) {
    return null;
  }

  const nextDate = nextWorkingDay(plannedDate);

  const onClick = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await carryOverTaskAction(projectId, taskId);
      if (!result.ok) {
        setError(result.error);
      } else {
        setMessage(result.message ?? null);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
        Перенести на следующий рабочий день ({formatDateLong(nextDate)})
      </Button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
