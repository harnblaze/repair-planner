"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BADGE_BASE } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { boardListSchema, type BoardListInput } from "@/lib/validation/board-list";

import { deleteBoardListAction, moveBoardListAction, renameBoardListAction } from "./actions";

export type ListRowData = { id: string; name: string; isSystem: boolean; itemCount: number };

export function ListRow({
  projectId,
  list,
  index,
  total,
  canEdit,
}: {
  projectId: string;
  list: ListRowData;
  /** Позиция списка на доске (0 — первый после «Текущих заявок»). */
  index: number;
  total: number;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BoardListInput>({
    resolver: zodResolver(boardListSchema),
    defaultValues: { name: list.name },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await renameBoardListAction(projectId, list.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const move = (position: number) => {
    startTransition(async () => {
      const result = await moveBoardListAction(projectId, { listId: list.id, position });
      if (!result.ok) toast.error(result.error);
    });
  };

  const onDelete = () => {
    const warning =
      list.itemCount > 0
        ? `Удалить список «${list.name}» вместе с записями (${list.itemCount})? Это нельзя отменить.`
        : `Удалить список «${list.name}»?`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteBoardListAction(projectId, list.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Список удалён.");
      }
    });
  };

  if (editing && canEdit) {
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
    <div className="flex items-center gap-2 py-1">
      {canEdit ? (
        <div className="flex flex-none items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending || index === 0}
            onClick={() => move(index - 1)}
            aria-label={`Переместить «${list.name}» выше`}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending || index === total - 1}
            onClick={() => move(index + 1)}
            aria-label={`Переместить «${list.name}» ниже`}
          >
            ↓
          </Button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[12.5px] text-ink" title={list.name}>
          {list.name}
        </span>
        {/* На узком экране бейдж отнимал бы место у названия; стандартный список
            и так отличается отсутствием кнопки «Удалить». */}
        {list.isSystem ? (
          <span className={cn(BADGE_BASE, "hidden bg-page text-meta-alt sm:inline-block")}>
            стандартный
          </span>
        ) : null}
        <span className="flex-none font-mono text-[11px] text-counter">{list.itemCount}</span>
      </div>
      {canEdit ? (
        <div className="flex flex-none items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
          {!list.isSystem ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
              Удалить
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
