"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BellIcon, BoxIcon, ClockIcon, ListIcon, PlusIcon } from "@/components/common/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";

import { createBoardItemAction } from "./actions";
import { BoardItemRow, type BoardItem } from "./board-item-row";
import { PANEL_FORM_CLASS, Panel, PanelEmpty, PanelHeader } from "./panel";

// Иконка и текст пустого состояния подбираются по названию списка: сами списки
// создаются в БД, поэтому жёсткой привязки к id здесь нет (docs/redesign.md §6).
function presentation(name: string): { icon: React.ReactNode; empty: string } {
  if (/материал/i.test(name)) return { icon: <BoxIcon />, empty: "Нет материалов к заказу" };
  if (/напомин/i.test(name)) return { icon: <BellIcon />, empty: "Нет напоминаний" };
  if (/мероприят/i.test(name)) return { icon: <ClockIcon />, empty: "Нет мероприятий" };
  return { icon: <ListIcon />, empty: "Список пуст" };
}

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
  const [pending, startTransition] = useTransition();
  const { icon, empty } = presentation(name);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BoardItemInput>({ resolver: zodResolver(boardItemSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createBoardItemAction(projectId, listId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Добавлено.");
        reset();
      }
    });
  });

  return (
    <Panel>
      <PanelHeader icon={icon} title={name} />
      <form onSubmit={onSubmit} className={PANEL_FORM_CLASS} noValidate>
        <div className="flex gap-2">
          <Input placeholder="Добавить" {...register("title")} />
          <Button type="submit" disabled={pending}>
            <PlusIcon />
            Добавить
          </Button>
        </div>
        {errors.title ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.title.message}</p>
        ) : null}
      </form>
      {items.length === 0 ? (
        <PanelEmpty>{empty}</PanelEmpty>
      ) : (
        <div className="flex flex-col p-1.5">
          {items.map((item) => (
            <BoardItemRow key={item.id} projectId={projectId} item={item} today={today} />
          ))}
        </div>
      )}
    </Panel>
  );
}
