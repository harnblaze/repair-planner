"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

import { createTaskAction } from "./actions";

export function CreateTaskForm({ projectId }: { projectId: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTaskInput>({ resolver: zodResolver(createTaskSchema) });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createTaskAction(projectId, data);
      if (!result.ok) setServerError(result.error);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Название заявки" {...register("title")} />
        {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
        {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Создание…" : "Создать"}
      </Button>
    </form>
  );
}
