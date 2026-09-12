"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executorSchema, type ExecutorInput } from "@/lib/validation/reference-data";

import { createExecutorAction } from "./actions";

export function CreateExecutorForm({ projectId }: { projectId: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExecutorInput>({ resolver: zodResolver(executorSchema) });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createExecutorAction(projectId, data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Имя" {...register("name")} />
        {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Должность" {...register("position")} />
        {errors.position ? (
          <p className="text-sm text-destructive">{errors.position.message}</p>
        ) : null}
        {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Добавление…" : "Добавить"}
      </Button>
    </form>
  );
}
