"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateShort } from "@/lib/business/dates";
import { cn } from "@/lib/utils";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";

import { deleteBoardItemAction, setBoardItemDoneAction, updateBoardItemAction } from "./actions";

export type BoardItem = {
  id: string;
  title: string;
  note: string | null;
  is_done: boolean;
  due_date: string | null;
};

export function BoardItemRow({
  projectId,
  item,
  today,
}: {
  projectId: string;
  item: BoardItem;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BoardItemInput>({
    resolver: zodResolver(boardItemSchema),
    defaultValues: {
      title: item.title,
      note: item.note ?? "",
      dueDate: item.due_date ?? "",
    },
  });

  const onSubmit = handleSubmit((data) => {
    setError(null);
    startTransition(async () => {
      const result = await updateBoardItemAction(projectId, item.id, data);
      if (!result.ok) {
        setError(result.error);
      } else {
        setEditing(false);
      }
    });
  });

  const toggleDone = () => {
    setError(null);
    startTransition(async () => {
      const result = await setBoardItemDoneAction(projectId, item.id, !item.is_done);
      if (!result.ok) setError(result.error);
    });
  };

  const onDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteBoardItemAction(projectId, item.id);
      if (!result.ok) setError(result.error);
    });
  };

  const isOverdue = !item.is_done && !!item.due_date && item.due_date < today;

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-1 py-1.5" noValidate>
        <Input {...register("title")} autoFocus />
        {errors.title ? <p className="text-sm text-destructive">{errors.title.message}</p> : null}
        <Input placeholder="Примечание" {...register("note")} />
        {errors.note ? <p className="text-sm text-destructive">{errors.note.message}</p> : null}
        <Input type="date" {...register("dueDate")} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            Сохранить
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 rounded border-border"
        checked={item.is_done}
        disabled={pending}
        onChange={toggleDone}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn("text-sm leading-snug", item.is_done && "text-muted-foreground line-through")}
        >
          {item.title}
        </p>
        {item.note ? (
          <p className="text-xs leading-snug text-muted-foreground">{item.note}</p>
        ) : null}
        {item.due_date ? (
          <p className={cn("text-xs leading-snug", isOverdue ? "text-destructive" : "text-muted-foreground")}>
            до {formatDateShort(item.due_date)}
            {isOverdue ? " — просрочено" : ""}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Изменить
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
          Удалить
        </Button>
      </div>
    </div>
  );
}
