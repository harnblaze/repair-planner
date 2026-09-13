"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { boardListSchema, type BoardListInput } from "@/lib/validation/board-list";

import { createBoardListAction } from "./actions";

export function CreateListForm({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardListInput>({ resolver: zodResolver(boardListSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createBoardListAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Список добавлен на доску.");
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Название списка" {...register("name")} />
        {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Добавление…" : "Добавить"}
      </Button>
    </form>
  );
}
