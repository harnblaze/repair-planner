"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSubmittablePlanDate } from "@/lib/business/plan-date-input";

import { setTaskPlannedDateAction } from "./actions";

// Пауза после последнего изменения: при вводе с клавиатуры поле отдаёт
// промежуточные значения (день "01" до "13", год "0002" до "2026").
const SAVE_DELAY_MS = 600;

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
  const savedRef = useRef(plannedDate ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const cancelScheduled = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => cancelScheduled, []);

  // Рабочий ли день, зависит от календаря проекта — проверяет Server Action
  // (и БД); при отказе поле возвращается к сохранённой дате. Server Actions
  // выполняются по очереди, поэтому ответы приходят в порядке отправки:
  // успешный ответ всегда обновляет сохранённую дату, а откат и ошибку
  // показываем только для последнего запроса.
  const save = (next: string) => {
    cancelScheduled();
    if (next === savedRef.current || !isSubmittablePlanDate(next)) return;

    const request = ++requestRef.current;
    void setTaskPlannedDateAction(projectId, taskId, next || null).then((result) => {
      if (result.ok) {
        savedRef.current = next;
      } else if (request === requestRef.current) {
        setValue(savedRef.current);
        toast.error(result.error);
      }
    });
  };

  const onChange = (next: string) => {
    setValue(next);
    cancelScheduled();
    if (next !== savedRef.current && isSubmittablePlanDate(next)) {
      timerRef.current = setTimeout(() => save(next), SAVE_DELAY_MS);
    }
  };

  // Уход из поля: полную дату сохраняем сразу, недописанную — откатываем.
  const commit = () => {
    if (isSubmittablePlanDate(value)) {
      save(value);
    } else {
      cancelScheduled();
      setValue(savedRef.current);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="plan-date">Запланировано на</Label>
      <Input
        id="plan-date"
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {disabled ? null : (
        <p className="text-[11px] text-meta-alt">
          Очистите дату, чтобы вернуть заявку в «Текущие заявки».
        </p>
      )}
    </div>
  );
}
