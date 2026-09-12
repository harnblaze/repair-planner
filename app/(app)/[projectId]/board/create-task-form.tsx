"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

import { createTaskFromBoardAction } from "./actions";

type Category = { id: string; name: string };

export function CreateTaskForm({
  projectId,
  categories,
}: {
  projectId: string;
  categories: Category[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTaskInput>({ resolver: zodResolver(createTaskSchema) });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createTaskFromBoardAction(projectId, data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1" noValidate>
      <div className="flex items-start gap-2">
        <Input placeholder="Новая заявка" {...register("title")} />
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "…" : "Добавить"}
        </Button>
      </div>
      <select
        className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        {...register("categoryId")}
        defaultValue=""
      >
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
    </form>
  );
}
