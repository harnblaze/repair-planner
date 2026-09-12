"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateTaskSchema, type UpdateTaskInput } from "@/lib/validation/task";

import { updateTaskAction } from "./actions";

type Category = { id: string; name: string };

export function TaskDetailsForm({
  projectId,
  taskId,
  task,
  categories,
}: {
  projectId: string;
  taskId: string;
  task: UpdateTaskInput;
  categories: Category[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateTaskInput>({
    resolver: zodResolver(updateTaskSchema),
    defaultValues: task,
  });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await updateTaskAction(projectId, taskId, data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        setSuccessMessage("Сохранено.");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Название</Label>
        <Input id="title" {...register("title")} />
        {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Описание</Label>
        <textarea
          id="description"
          rows={4}
          className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          {...register("description")}
        />
        {errors.description ? (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="categoryId">Категория</Label>
        <select
          id="categoryId"
          className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          {...register("categoryId")}
        >
          <option value="">Без категории</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {successMessage ? <p className="text-sm text-muted-foreground">{successMessage}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Сохранение…" : "Сохранить"}
      </Button>
    </form>
  );
}
