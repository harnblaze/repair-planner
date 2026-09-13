"use client";

import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useOptimistic, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BellIcon, BoxIcon, ClockIcon, ListIcon, PlusIcon } from "@/components/common/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { boardItemSchema, type BoardItemInput } from "@/lib/validation/board-item";

import { createBoardItemAction, moveBoardItemAction } from "./actions";
import { BoardItemRow, type BoardItem } from "./board-item-row";
import { BOARD_ACCESSIBILITY, useBoardSensors, useSuppressClickAfterDrag } from "./dnd";
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
  canEdit,
}: {
  projectId: string;
  listId: string;
  name: string;
  items: BoardItem[];
  today: string;
  /** false — только просмотр: без добавления, правки и перетаскивания. */
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { icon, empty } = presentation(name);

  // Порядок записей — перетаскиванием внутри списка (board_items.position).
  const dndId = useId();
  const sensors = useBoardSensors();
  const clicks = useSuppressClickAfterDrag();
  const [orderedItems, moveOptimistic] = useOptimistic(
    items,
    (current, move: { from: number; to: number }) => arrayMove(current, move.from, move.to),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    clicks.onDragFinish();
    if (!over || active.id === over.id) return;
    const from = orderedItems.findIndex((item) => item.id === active.id);
    const to = orderedItems.findIndex((item) => item.id === over.id);
    if (from === -1 || to === -1) return;

    startTransition(async () => {
      moveOptimistic({ from, to });
      const result = await moveBoardItemAction(projectId, { itemId: String(active.id), position: to });
      if (!result.ok) toast.error(result.error);
    });
  };

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
      {canEdit ? (
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
      ) : null}
      {items.length === 0 ? (
        <PanelEmpty>{empty}</PanelEmpty>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          accessibility={BOARD_ACCESSIBILITY}
          onDragStart={clicks.onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={clicks.onDragFinish}
        >
          <SortableContext items={orderedItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col p-1.5" onClickCapture={clicks.onClickCapture}>
              {orderedItems.map((item) => (
                <BoardItemRow
                  key={item.id}
                  projectId={projectId}
                  item={item}
                  today={today}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </Panel>
  );
}
