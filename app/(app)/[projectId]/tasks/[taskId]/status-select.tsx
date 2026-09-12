"use client";

import { useState, useTransition } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onChange = (next: TaskStatus) => {
    setError(null);
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setTaskStatusAction(projectId, taskId, next);
      if (!result.ok) {
        setCurrent(previous);
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
        className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
