"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categorySchema, type CategoryInput } from "@/lib/validation/reference-data";

import { setCategoryArchivedAction, updateCategoryAction } from "./actions";

type Category = { id: string; name: string; is_archived: boolean };

export function CategoryRow({ projectId, category }: { projectId: string; category: Category }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category.name },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await updateCategoryAction(projectId, category.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const toggleArchived = () => {
    startTransition(async () => {
      const result = await setCategoryArchivedAction(projectId, category.id, !category.is_archived);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(category.is_archived ? "Категория восстановлена." : "Категория архивирована.");
      }
    });
  };

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex items-start gap-2 py-1" noValidate>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("name")} autoFocus />
          {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
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
      <span className={category.is_archived ? "text-meta line-through" : ""}>
        {category.name}
      </span>
      <div className="flex items-center gap-2">
        {!category.is_archived ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={toggleArchived}>
          {category.is_archived ? "Восстановить" : "Архивировать"}
        </Button>
      </div>
    </div>
  );
}
