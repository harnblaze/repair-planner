"use client";

import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";

import { setTaskExecutorsAction } from "./actions";

type Executor = { id: string; name: string; position: string | null; is_active: boolean };

export function ExecutorsPicker({
  projectId,
  taskId,
  executors,
  assignedExecutorIds,
}: {
  projectId: string;
  taskId: string;
  executors: Executor[];
  assignedExecutorIds: string[];
}) {
  const [selected, setSelected] = useState(new Set(assignedExecutorIds));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = executors.filter((e) => e.is_active);
  const inactive = executors.filter((e) => !e.is_active);

  const toggle = (executorId: string) => {
    setError(null);
    const next = new Set(selected);
    if (next.has(executorId)) {
      next.delete(executorId);
    } else {
      next.add(executorId);
    }
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const result = await setTaskExecutorsAction(projectId, taskId, Array.from(next));
      if (!result.ok) {
        setSelected(previous);
        setError(result.error);
      }
    });
  };

  const renderCheckbox = (executor: Executor) => (
    <label key={executor.id} className="flex items-center gap-2 py-1 text-sm">
      <input
        type="checkbox"
        checked={selected.has(executor.id)}
        disabled={pending}
        onChange={() => toggle(executor.id)}
      />
      <span>
        {executor.name}
        {executor.position ? (
          <span className="text-muted-foreground"> — {executor.position}</span>
        ) : null}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>Исполнители</Label>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет активных исполнителей.</p>
      ) : (
        <div className="flex flex-col">{active.map(renderCheckbox)}</div>
      )}

      {inactive.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Показать неактивных ({inactive.length})
          </summary>
          <div className="flex flex-col pt-1">{inactive.map(renderCheckbox)}</div>
        </details>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
