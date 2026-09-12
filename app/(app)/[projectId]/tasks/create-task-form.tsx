"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

import { createTaskAction } from "./actions";

type Category = { id: string; name: string };

export function CreateTaskForm({
  projectId,
  categories,
}: {
  projectId: string;
  categories: Category[];
}) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTaskInput>({ resolver: zodResolver(createTaskSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      // При успехе createTaskAction делает redirect() на карточку заявки —
      // сюда управление не возвращается, поэтому success-ветки здесь нет.
      const result = await createTaskAction(projectId, data);
      if (!result.ok) toast.error(result.error);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Название заявки" {...register("title")} />
        {errors.title ? <p className="text-[11.5px] text-status-alert-fg">{errors.title.message}</p> : null}
      </div>
      <NativeSelect {...register("categoryId")} defaultValue="">
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" disabled={pending}>
        {pending ? "Создание…" : "Создать"}
      </Button>
    </form>
  );
}
