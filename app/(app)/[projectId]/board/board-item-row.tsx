"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BADGE_BASE } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateShort } from "@/lib/business/dates";
import { cn } from "@/lib/utils";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";

import { deleteBoardItemAction, setBoardItemDoneAction, updateBoardItemAction } from "./actions";
import { dragAttributes, dragListeners } from "./dnd";

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
  const [pending, startTransition] = useTransition();

  // Во время редактирования строка не перетаскивается — иначе выделение текста
  // в полях формы начинало бы перетаскивание.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { title: item.title },
    disabled: editing,
  });
  const sortableStyle = { transform: CSS.Translate.toString(transform), transition };

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
    startTransition(async () => {
      const result = await updateBoardItemAction(projectId, item.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const toggleDone = () => {
    startTransition(async () => {
      const result = await setBoardItemDoneAction(projectId, item.id, !item.is_done);
      if (!result.ok) toast.error(result.error);
    });
  };

  const onDelete = () => {
    if (!window.confirm(`Удалить «${item.title}»?`)) return;
    startTransition(async () => {
      const result = await deleteBoardItemAction(projectId, item.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Удалено.");
      }
    });
  };

  const isOverdue = !item.is_done && !!item.due_date && item.due_date < today;
  const meta = [item.note, item.due_date ? `до ${formatDateShort(item.due_date)}` : null]
    .filter(Boolean)
    .join(" · ");

  if (editing) {
    return (
      <form
        ref={setNodeRef}
        style={sortableStyle}
        onSubmit={onSubmit}
        className="flex flex-col gap-2 px-[9px] py-2"
        noValidate
      >
        <Input {...register("title")} autoFocus />
        {errors.title ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.title.message}</p>
        ) : null}
        <Input placeholder="Примечание" {...register("note")} />
        {errors.note ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.note.message}</p>
        ) : null}
        <Input type="date" {...register("dueDate")} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            Сохранить
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      {...dragAttributes(attributes)}
      {...dragListeners(listeners)}
      className={cn(
        "group relative flex touch-manipulation items-center gap-2.5 rounded-[7px] bg-surface px-[9px] py-2 transition-colors duration-120 select-none hover:bg-row-hover",
        isDragging && "z-10 shadow-[0_6px_16px_rgba(20,30,50,0.14)]",
      )}
    >
      <input
        type="checkbox"
        className="size-3.5 shrink-0 cursor-pointer accent-[var(--color-brand)]"
        checked={item.is_done}
        disabled={pending}
        aria-label={
          item.is_done ? `Вернуть «${item.title}» в работу` : `Отметить «${item.title}» выполненным`
        }
        onChange={toggleDone}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-[12.5px] font-semibold text-ink",
            item.is_done && "text-meta-alt line-through",
          )}
        >
          {item.title}
        </span>
        {meta ? <span className="truncate text-[11px] text-meta-alt">{meta}</span> : null}
      </div>
      {isOverdue ? (
        <span className={cn(BADGE_BASE, "bg-status-alert-bg text-status-alert-fg")}>
          просрочено
        </span>
      ) : null}
      {/* Действия перекрывают строку, а не занимают её ширину: в панели шириной
          ~150px иначе не остаётся места под название (docs/redesign.md §6). */}
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 rounded-[7px] bg-row-hover pl-3 opacity-0 transition-opacity duration-120 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
          Изменить
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={onDelete}>
          Удалить
        </Button>
      </div>
    </div>
  );
}
