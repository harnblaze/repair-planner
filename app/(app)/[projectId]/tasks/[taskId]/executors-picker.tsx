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
import { executorsSummary } from "@/lib/business/executor-names";

import { setTaskExecutorsAction } from "./actions";
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

  const onValueChange = (next: string[]) => {
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const result = await setTaskExecutorsAction(projectId, taskId, next);
      if (!result.ok) {
        setSelected(previous);
        toast.error(result.error);
      }
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
