"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executorSchema, type ExecutorInput } from "@/lib/validation/reference-data";

import { setExecutorActiveAction, updateExecutorAction } from "./actions";

type Executor = { id: string; name: string; position: string | null; is_active: boolean };

export function ExecutorRow({
  projectId,
  executor,
  canEdit,
}: {
  projectId: string;
  executor: Executor;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExecutorInput>({
    resolver: zodResolver(executorSchema),
    defaultValues: { name: executor.name, position: executor.position ?? "" },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await updateExecutorAction(projectId, executor.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const toggleActive = () => {
    startTransition(async () => {
      const result = await setExecutorActiveAction(projectId, executor.id, !executor.is_active);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(executor.is_active ? "Исполнитель деактивирован." : "Исполнитель активирован.");
      }
    });
  };

  if (editing && canEdit) {
    return (
      <form onSubmit={onSubmit} className="flex items-start gap-2 py-1" noValidate>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("name")} autoFocus />
          {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("position")} placeholder="Должность" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          Сохранить
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Отмена
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className={executor.is_active ? "" : "text-meta line-through"}>
        {executor.name}
        {executor.position ? (
          <span className="text-meta"> — {executor.position}</span>
        ) : null}
      </span>
      {canEdit ? (
        <div className="flex items-center gap-2">
          {executor.is_active ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Изменить
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
            {executor.is_active ? "Деактивировать" : "Активировать"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
