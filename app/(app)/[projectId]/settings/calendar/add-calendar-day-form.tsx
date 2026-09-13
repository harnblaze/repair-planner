"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calendarDaySchema, type CalendarDayInput } from "@/lib/validation/calendar";

import { addCalendarDayAction } from "./actions";

export function AddCalendarDayForm({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CalendarDayInput>({
    resolver: zodResolver(calendarDaySchema),
    defaultValues: { day: "", name: "" },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await addCalendarDayAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "День добавлен.");
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="calendar-day" className="sr-only">
            Дата
          </Label>
          <Input id="calendar-day" type="date" className="w-[150px]" {...register("day")} />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <Label htmlFor="calendar-day-name" className="sr-only">
            Название
          </Label>
          <Input id="calendar-day-name" placeholder="Название (необязательно)" {...register("name")} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Добавление…" : "Добавить"}
        </Button>
      </div>
      {errors.day ? <p className="text-[11.5px] text-status-alert-fg">{errors.day.message}</p> : null}
      {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
      <p className="text-[11px] text-meta-alt">
        Будний день станет нерабочим, суббота — рабочей.
      </p>
    </form>
  );
}
