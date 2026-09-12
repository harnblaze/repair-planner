"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <div className="flex flex-col gap-2">
      <Label>Исполнители</Label>
      <Select multiple value={selected} onValueChange={onValueChange} disabled={pending}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(value: string[]) => {
              if (!value || value.length === 0) return "Не назначены";
              const first = nameById.get(value[0]) ?? "";
              return value.length > 1 ? `${first} и ещё ${value.length - 1}` : first;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {active.length === 0 ? (
            <SelectLabel>Нет активных исполнителей</SelectLabel>
          ) : (
            active.map((executor) => (
              <SelectItem key={executor.id} value={executor.id}>
                {executor.name}
                {executor.position ? ` — ${executor.position}` : ""}
              </SelectItem>
            ))
          )}
          {inactive.length > 0 ? (
            <>
              <SelectSeparator />
              <SelectLabel>Неактивные</SelectLabel>
              {inactive.map((executor) => (
                <SelectItem key={executor.id} value={executor.id}>
                  {executor.name}
                  {executor.position ? ` — ${executor.position}` : ""}
                </SelectItem>
              ))}
            </>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
