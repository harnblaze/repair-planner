"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/ui/native-select";
import { TASK_STATUSES, type TaskStatus } from "@/lib/business/task-status";

import { setTaskStatusAction } from "./actions";

export function StatusSelect({
  projectId,
  taskId,
  status,
}: {
  projectId: string;
  taskId: string;
  status: TaskStatus;
}) {
  const [current, setCurrent] = useState(status);
  const [pending, startTransition] = useTransition();

  const onChange = (next: TaskStatus) => {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setTaskStatusAction(projectId, taskId, next);
      if (!result.ok) {
        setCurrent(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <NativeSelect
      wrapperClassName="w-44"
      aria-label="Статус заявки"
      value={current}
      disabled={pending}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </NativeSelect>
  );
}
