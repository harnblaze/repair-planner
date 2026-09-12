"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isWorkingDay } from "@/lib/business/working-days";

import { setTaskPlannedDateAction } from "./actions";

export function PlanTaskForm({
  projectId,
  taskId,
  plannedDate,
}: {
  projectId: string;
  taskId: string;
  plannedDate: string | null;
}) {
  const [value, setValue] = useState(plannedDate ?? "");
  const [savedValue, setSavedValue] = useState(plannedDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    setError(null);

    if (next && !isWorkingDay(next)) {
      setError("Планировать можно только на рабочий день (Пн–Пт).");
      return;
    }

    setValue(next);
    startTransition(async () => {
      const result = await setTaskPlannedDateAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(savedValue);
        setError(result.error);
      } else {
        setSavedValue(next);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="plan-date">Запланировано на</Label>
      <Input
        id="plan-date"
        type="date"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Очистите дату, чтобы вернуть заявку в «Текущие заявки».
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
