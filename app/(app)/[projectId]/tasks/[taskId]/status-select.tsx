"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { STATUS_CLASSES, StatusBadge } from "@/components/common/status-badge";
import { NativeSelect } from "@/components/ui/native-select";
import { TASK_STATUSES, type TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

import { setTaskStatusAction } from "./actions";

export function StatusSelect({
  projectId,
  taskId,
  status,
  disabled = false,
}: {
  projectId: string;
  taskId: string;
  status: TaskStatus;
  disabled?: boolean;
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

  // Только просмотр: цветной бейдж вместо серого заблокированного списка.
  if (disabled) {
    return <StatusBadge status={status} className="flex-none self-start px-2 py-1.5 text-[12px]" />;
  }

  return (
    <NativeSelect
      wrapperClassName="w-40 flex-none"
      className={cn("border-transparent font-semibold", STATUS_CLASSES[current])}
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
