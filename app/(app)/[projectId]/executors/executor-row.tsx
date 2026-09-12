"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executorSchema, type ExecutorInput } from "@/lib/validation/reference-data";

import { setExecutorActiveAction, updateExecutorAction } from "./actions";

type Executor = { id: string; name: string; position: string | null; is_active: boolean };

export function ExecutorRow({ projectId, executor }: { projectId: string; executor: Executor }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    startTransition(async () => {
      const result = await updateExecutorAction(projectId, executor.id, data);
      if (!result.ok) {
        setError(result.error);
      } else {
        setEditing(false);
      }
    });
  });

  const toggleActive = () => {
    setError(null);
    startTransition(async () => {
      const result = await setExecutorActiveAction(projectId, executor.id, !executor.is_active);
      if (!result.ok) setError(result.error);
    });
  };

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex items-start gap-2 py-1" noValidate>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("name")} autoFocus />
          {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("position")} placeholder="Должность" />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
      <span className={executor.is_active ? "" : "text-muted-foreground line-through"}>
        {executor.name}
        {executor.position ? (
          <span className="text-muted-foreground"> — {executor.position}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {executor.is_active ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
          {executor.is_active ? "Деактивировать" : "Активировать"}
        </Button>
      </div>
    </div>
  );
}
