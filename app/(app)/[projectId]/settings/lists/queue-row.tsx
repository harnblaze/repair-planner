"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { taskQueueSchema, type TaskQueueInput } from "@/lib/validation/task-queue";

import { deleteTaskQueueAction, moveTaskQueueAction, renameTaskQueueAction } from "./actions";

export type QueueRowData = { id: string; name: string };

export function QueueRow({
  projectId,
  queue,
  index,
  total,
  canEdit,
}: {
  projectId: string;
  queue: QueueRowData;
  /** Место среди своих очередей: «Текущие заявки» всегда первые и в порядке не участвуют. */
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
  } = useForm<TaskQueueInput>({
    resolver: zodResolver(taskQueueSchema),
    defaultValues: { name: queue.name },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await renameTaskQueueAction(projectId, queue.id, data);
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
      const result = await moveTaskQueueAction(projectId, { queueId: queue.id, position });
      if (!result.ok) toast.error(result.error);
    });
  };

  const onDelete = () => {
    if (!window.confirm(`Удалить очередь «${queue.name}»? Её заявки перейдут в «Текущие заявки».`)) return;

    startTransition(async () => {
      const result = await deleteTaskQueueAction(projectId, queue.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Очередь удалена.");
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
            aria-label={`Переместить «${queue.name}» выше`}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending || index === total - 1}
            onClick={() => move(index + 1)}
            aria-label={`Переместить «${queue.name}» ниже`}
          >
            ↓
          </Button>
        </div>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={queue.name}>
        {queue.name}
      </span>
      {canEdit ? (
        <div className="flex flex-none items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
            Удалить
          </Button>
        </div>
      ) : null}
    </div>
  );
}
