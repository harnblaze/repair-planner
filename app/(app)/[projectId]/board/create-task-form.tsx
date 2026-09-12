"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PlusIcon } from "@/components/common/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createTaskSchema, type CreateTaskInput } from "@/lib/validation/task";

import { createTaskFromBoardAction } from "./actions";
import { PANEL_FORM_CLASS } from "./panel";

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
    reset,
    formState: { errors },
  } = useForm<CreateTaskInput>({ resolver: zodResolver(createTaskSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createTaskFromBoardAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Заявка добавлена.");
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className={PANEL_FORM_CLASS} noValidate>
      <div className="flex gap-2">
        <Input placeholder="Новая заявка" {...register("title")} />
        <Button type="submit" disabled={pending}>
          <PlusIcon />
          Добавить
        </Button>
      </div>
      <NativeSelect aria-label="Категория" {...register("categoryId")} defaultValue="">
        <option value="">Без категории</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
      {errors.title ? (
        <p className="text-[11.5px] text-status-alert-fg">{errors.title.message}</p>
      ) : null}
    </form>
  );
}
