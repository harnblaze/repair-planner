"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { setTaskPlannedDateAction } from "./actions";

export function PlanTaskForm({
  projectId,
  taskId,
  plannedDate,
  disabled = false,
}: {
  projectId: string;
  taskId: string;
  plannedDate: string | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(plannedDate ?? "");
  const [savedValue, setSavedValue] = useState(plannedDate ?? "");
  const [pending, startTransition] = useTransition();

  // Рабочий ли день, зависит от календаря проекта — проверяет Server Action
  // (и триггер БД); при отказе поле возвращается к сохранённой дате.
  const onChange = (next: string) => {
    setValue(next);
    startTransition(async () => {
      const result = await setTaskPlannedDateAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(savedValue);
        toast.error(result.error);
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
        disabled={pending || disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {disabled ? null : (
        <p className="text-[11px] text-meta-alt">
          Очистите дату, чтобы вернуть заявку в «Текущие заявки».
        </p>
      )}
    </div>
  );
}
