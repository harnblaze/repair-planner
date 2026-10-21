"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { executorChanges, executorsSummary } from "@/lib/business/executor-names";

import { assignTaskExecutorAction, unassignTaskExecutorAction } from "./actions";
import { PropertyField } from "./property-field";

type Executor = { id: string; name: string; position: string | null; is_active: boolean };

export function ExecutorsPicker({
  projectId,
  taskId,
  executors,
  assignedExecutorIds,
  disabled = false,
}: {
  projectId: string;
  taskId: string;
  executors: Executor[];
  assignedExecutorIds: string[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(assignedExecutorIds);
  const [pending, startTransition] = useTransition();

  const active = executors.filter((e) => e.is_active);
  const inactive = executors.filter((e) => !e.is_active);
  const nameById = new Map(executors.map((e) => [e.id, e.name]));

  // Каждое изменение — отдельное атомарное назначение/снятие; при ошибке
  // откатывается только то, что не сохранилось.
  const onValueChange = (next: string[]) => {
    const { added, removed } = executorChanges(selected, next);
    setSelected(next);
    startTransition(async () => {
      const results = await Promise.all([
        ...added.map(async (id) => ({ id, assign: true, result: await assignTaskExecutorAction(projectId, taskId, id) })),
        ...removed.map(async (id) => ({
          id,
          assign: false,
          result: await unassignTaskExecutorAction(projectId, taskId, id),
        })),
      ]);
      const failed = results.filter((r) => !r.result.ok);
      if (failed.length === 0) return;
      setSelected((current) =>
        failed.reduce(
          (ids, f) => (f.assign ? ids.filter((id) => id !== f.id) : ids.includes(f.id) ? ids : [...ids, f.id]),
          current,
        ),
      );
      const first = failed[0].result;
      toast.error(first.ok ? "Не удалось изменить исполнителей. Попробуйте ещё раз." : first.error);
    });
  };

  return (
    <PropertyField label="Исполнители">
      <Select multiple value={selected} onValueChange={onValueChange} disabled={pending || disabled}>
        <SelectTrigger className="w-full min-w-0" aria-label="Исполнители">
          <SelectValue className="truncate">
            {(value: string[]) => executorsSummary((value ?? []).map((id) => nameById.get(id) ?? ""))}
          </SelectValue>
        </SelectTrigger>
        {/* Под полем, а не поверх: при выборе нескольких исполнителей поле с итогом остаётся видно. */}
        <SelectContent alignItemWithTrigger={false} align="start">
          {/* SelectLabel работает только внутри SelectGroup — иначе Base UI роняет страницу. */}
          <SelectGroup>
            {active.length === 0 ? (
              <SelectLabel>Нет активных исполнителей</SelectLabel>
            ) : (
              active.map((executor) => (
                <SelectItem key={executor.id} value={executor.id}>
                  <ExecutorOption executor={executor} />
                </SelectItem>
              ))
            )}
          </SelectGroup>
          {inactive.length > 0 ? (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Неактивные</SelectLabel>
                {inactive.map((executor) => (
                  <SelectItem key={executor.id} value={executor.id}>
                    <ExecutorOption executor={executor} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          ) : null}
        </SelectContent>
      </Select>
    </PropertyField>
  );
}

function ExecutorOption({ executor }: { executor: Executor }) {
  return (
    <>
      <span className="truncate">{executor.name}</span>
      {executor.position ? <span className="truncate text-meta">{executor.position}</span> : null}
    </>
  );
}
