"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";

import { createBoardItemAction } from "./actions";
import { BoardItemRow, type BoardItem } from "./board-item-row";

export function BoardList({
  projectId,
  listId,
  name,
  items,
  today,
}: {
  projectId: string;
  listId: string;
  name: string;
  items: BoardItem[];
  today: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardItemInput>({ resolver: zodResolver(boardItemSchema) });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createBoardItemAction(projectId, listId, data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        reset();
      }
    });
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{name}</h2>
      <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
        <Input placeholder="Добавить" {...register("title")} />
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "…" : "Добавить"}
        </Button>
      </form>
      {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
      <div className="flex flex-col">
        {items.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">Пусто.</p>
        ) : (
          items.map((item) => (
            <BoardItemRow key={item.id} projectId={projectId} item={item} today={today} />
          ))
        )}
      </div>
    </div>
  );
}
