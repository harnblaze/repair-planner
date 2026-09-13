"use client";

import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { BookmarkIcon } from "@/components/common/icons";
import { formatDateLong, formatDateShort } from "@/lib/business/dates";
import {
  canPlanOnDate,
  canReturnToBacklog,
  keepsDayOnReturnToBacklog,
} from "@/lib/business/task-planning";
import { WEEKDAY_LABELS_RU } from "@/lib/business/working-days";
import type { ActionResult } from "@/lib/types/action-result";
import { cn } from "@/lib/utils";

import {
  moveTaskScheduleAction,
  planTaskOnDayAction,
  returnTaskToBacklogAction,
} from "./actions";
import { CreateTaskForm } from "./create-task-form";
import {
  BOARD_ACCESSIBILITY,
  dragAttributes,
  dragListeners,
  useBoardSensors,
  useSuppressClickAfterDrag,
} from "./dnd";
import { Panel, PanelEmpty, PanelHeader } from "./panel";
import { TaskChip, TaskRow, type BoardTask } from "./task-chip";

// Неделя доски и «Текущие заявки» в одном DndContext: задачу можно
// запланировать, сменить ей день, упорядочить внутри дня и вернуть обратно.
// Правила — lib/business/task-planning.ts, окончательная проверка — RPC
// supabase/migrations/0008. Интерфейс обновляется сразу (useOptimistic);
// при ошибке сервера состояние само возвращается к данным сервера.

export type DayTask = BoardTask & { canChangeDay: boolean };
export type BacklogTask = BoardTask & { lastWorkDate: string | null };

const BACKLOG = "backlog";

type BoardState = { days: Record<string, DayTask[]>; backlog: BacklogTask[] };

/** container — дата "YYYY-MM-DD" или BACKLOG; taskId отсутствует у самой колонки. */
type DragData = { container: string; taskId?: string; title?: string };

type Move =
  | { type: "reorder"; date: string; from: number; to: number }
  | { type: "changeDay"; taskId: string; fromDate: string; toDate: string; index: number }
  | { type: "plan"; taskId: string; toDate: string; index: number }
  | { type: "toBacklog"; taskId: string; today: string };

function applyMove(state: BoardState, move: Move): BoardState {
  switch (move.type) {
    case "reorder":
      return {
        ...state,
        days: { ...state.days, [move.date]: arrayMove(state.days[move.date], move.from, move.to) },
      };

    case "changeDay": {
      const task = state.days[move.fromDate]?.find((t) => t.id === move.taskId);
      if (!task) return state;
      const target = [...state.days[move.toDate]];
      target.splice(move.index, 0, task);
      return {
        ...state,
        days: {
          ...state.days,
          [move.fromDate]: state.days[move.fromDate].filter((t) => t.id !== move.taskId),
          [move.toDate]: target,
        },
      };
    }

    case "plan": {
      const task = state.backlog.find((t) => t.id === move.taskId);
      if (!task) return state;
      // Возврат отложенной задачи в тот же день заменяет её историческую карточку.
      const target = state.days[move.toDate].filter((t) => t.id !== move.taskId);
      target.splice(Math.min(move.index, target.length), 0, {
        ...task,
        status: task.status === "new" ? "planned" : task.status,
        isHistory: false,
        transferNote: null,
        canChangeDay: task.lastWorkDate === null,
      });
      return {
        backlog: state.backlog.filter((t) => t.id !== move.taskId),
        days: { ...state.days, [move.toDate]: target },
      };
    }

    case "toBacklog": {
      let task: DayTask | undefined;
      let lastKept: string | null = null;
      const days: Record<string, DayTask[]> = {};

      for (const [date, tasks] of Object.entries(state.days)) {
        days[date] = tasks.flatMap((t) => {
          if (t.id !== move.taskId) return [t];
          task ??= t;
          if (!keepsDayOnReturnToBacklog(t.status, date, move.today)) return [];
          if (lastKept === null || date > lastKept) lastKept = date;
          return [{ ...t, isHistory: true, canChangeDay: false }];
        });
      }
      if (!task) return state;
      if (lastKept) {
        days[lastKept] = days[lastKept].map((t) =>
          t.id === move.taskId ? { ...t, transferNote: "Отложена" } : t,
        );
      }

      return {
        days,
        backlog: [
          { ...task, isHistory: false, transferNote: null, lastWorkDate: lastKept },
          ...state.backlog,
        ],
      };
    }
  }
}

type DropVerdict = { ok: true } | { ok: false; reason: string } | null;

const HISTORY_REASON = "Это день из истории заявки — его можно только упорядочить внутри дня.";

/** null — перемещение ничего не меняет; ok: false — запрещено с понятной причиной. */
function checkDrop(state: BoardState, from: DragData, target: string): DropVerdict {
  if (from.container === BACKLOG) {
    if (target === BACKLOG) return null;
    const task = state.backlog.find((t) => t.id === from.taskId);
    if (!task) return null;
    return canPlanOnDate(task.lastWorkDate, target)
      ? { ok: true }
      : {
          ok: false,
          reason: `Заявку уже вели до ${formatDateLong(task.lastWorkDate!)} — запланируйте её не раньше этого дня.`,
        };
  }

  const task = state.days[from.container]?.find((t) => t.id === from.taskId);
  if (!task) return null;

  if (target === BACKLOG) {
    if (task.isHistory) return { ok: false, reason: HISTORY_REASON };
    if (!canReturnToBacklog(task.status)) {
      return { ok: false, reason: "Завершённую или отменённую заявку нельзя вернуть в текущие заявки." };
    }
    return { ok: true };
  }

  if (target === from.container) return { ok: true };
  if (task.isHistory) return { ok: false, reason: HISTORY_REASON };
  if (!task.canChangeDay) {
    return {
      ok: false,
      reason:
        "Перенесённую заявку можно только упорядочить внутри дня. Дату можно изменить в карточке заявки.",
    };
  }
  return { ok: true };
}

// Под курсором и карточка, и колонка: карточка точнее задаёт место вставки.
// Без курсора (клавиатура) — ближайшая цель.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) {
    const card = within.find(
      (c) => (c.data?.droppableContainer?.data.current as DragData | undefined)?.taskId,
    );
    return [card ?? within[0]];
  }
  return closestCorners(args);
};

export function WeekBoard({
  projectId,
  today,
  weekDates,
  days,
  backlog,
  categories,
  children,
}: {
  projectId: string;
  today: string;
  weekDates: string[];
  days: Record<string, DayTask[]>;
  backlog: BacklogTask[];
  categories: { id: string; name: string }[];
  /** Остальные панели нижнего ряда — дополнительные списки. */
  children: React.ReactNode;
}) {
  const dndId = useId();
  const sensors = useBoardSensors();
  const clicks = useSuppressClickAfterDrag();
  const [, startTransition] = useTransition();

  const serverState = useMemo<BoardState>(() => ({ days, backlog }), [days, backlog]);
  const [board, applyOptimistic] = useOptimistic(serverState, applyMove);

  const [active, setActive] = useState<DragData | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);

  const dropAllowed = (container: string) =>
    active !== null && overContainer === container && checkDrop(board, active, container)?.ok === true;

  const run = (move: Move, action: () => Promise<ActionResult>) => {
    startTransition(async () => {
      applyOptimistic(move);
      const result = await action();
      if (!result.ok) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  const onDragStart = ({ active: dragged }: DragStartEvent) => {
    clicks.onDragStart();
    setActive(dragged.data.current as DragData);
  };

  const onDragOver = ({ over }: DragOverEvent) => {
    setOverContainer((over?.data.current as DragData | undefined)?.container ?? null);
  };

  const resetDrag = () => {
    clicks.onDragFinish();
    setActive(null);
    setOverContainer(null);
  };

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    resetDrag();
    if (!over) return;

    const from = dragged.data.current as DragData;
    const to = over.data.current as DragData;
    const taskId = from.taskId!;
    const verdict = checkDrop(board, from, to.container);

    if (verdict === null) return;
    if (!verdict.ok) {
      toast.error(verdict.reason);
      return;
    }

    if (to.container === BACKLOG) {
      run({ type: "toBacklog", taskId, today }, () => returnTaskToBacklogAction(projectId, taskId));
      return;
    }

    const toDate = to.container;
    const list = board.days[toDate] ?? [];
    const overIndex = to.taskId ? list.findIndex((t) => t.id === to.taskId) : -1;

    if (from.container === toDate) {
      const fromIndex = list.findIndex((t) => t.id === taskId);
      const toIndex = overIndex === -1 ? list.length - 1 : overIndex;
      if (fromIndex === -1 || fromIndex === toIndex) return;
      run({ type: "reorder", date: toDate, from: fromIndex, to: toIndex }, () =>
        moveTaskScheduleAction(projectId, { taskId, fromDate: toDate, toDate, position: toIndex }),
      );
      return;
    }

    // В чужом списке вставляем перед карточкой под курсором или после неё,
    // если перетаскиваемая карточка ниже её середины.
    const translated = dragged.rect.current.translated;
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;
    const index = overIndex === -1 ? list.length : overIndex + (below ? 1 : 0);

    if (from.container === BACKLOG) {
      run({ type: "plan", taskId, toDate, index }, () =>
        planTaskOnDayAction(projectId, { taskId, workDate: toDate, position: index }),
      );
    } else {
      run({ type: "changeDay", taskId, fromDate: from.container, toDate, index }, () =>
        moveTaskScheduleAction(projectId, { taskId, fromDate: from.container, toDate, position: index }),
      );
    }
  };

  const activeTask =
    active === null
      ? null
      : active.container === BACKLOG
        ? board.backlog.find((t) => t.id === active.taskId)
        : board.days[active.container]?.find((t) => t.id === active.taskId);

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={BOARD_ACCESSIBILITY}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={resetDrag}
    >
      <div className="contents" onClickCapture={clicks.onClickCapture}>
        {/* Неделя — ряд из пяти колонок на всю ширину, без прокрутки и без переноса
            (docs/redesign.md §4). minmax(0,1fr) обязателен: иначе длинный заголовок
            задачи распирает колонку. */}
        <section className="overflow-hidden rounded-[10px] border border-line-strong bg-surface">
          <div className="grid grid-cols-[repeat(5,minmax(0,1fr))]">
            {weekDates.map((date, i) => (
              <DayColumn
                key={date}
                projectId={projectId}
                date={date}
                label={WEEKDAY_LABELS_RU[i]}
                isToday={date === today}
                tasks={board.days[date] ?? []}
                highlighted={dropAllowed(date)}
              />
            ))}
          </div>
        </section>

        {/* Дополнительные списки: «Текущие заявки» (задачи) и board_lists
            («Материалы к заказу», «Напоминания», «Мероприятия») — четыре панели
            в одном ряду под неделей. */}
        <section className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2.5 xl:gap-3.5">
          <BacklogPanel
            projectId={projectId}
            tasks={board.backlog}
            categories={categories}
            highlighted={dropAllowed(BACKLOG)}
          />
          {children}
        </section>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && active ? (
          active.container === BACKLOG ? (
            <TaskRow
              projectId={projectId}
              task={activeTask}
              className="cursor-grabbing border border-line-card bg-surface shadow-[0_6px_16px_rgba(20,30,50,0.14)]"
            />
          ) : (
            <TaskChip
              projectId={projectId}
              task={activeTask}
              className="cursor-grabbing shadow-[0_6px_16px_rgba(20,30,50,0.14)]"
            />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const DROP_HIGHLIGHT = "ring-2 ring-inset ring-brand/40";

function DayColumn({
  projectId,
  date,
  label,
  isToday,
  tasks,
  highlighted,
}: {
  projectId: string;
  date: string;
  label: string;
  isToday: boolean;
  tasks: DayTask[];
  highlighted: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `day:${date}`, data: { container: date } satisfies DragData });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[216px] min-w-0 flex-col border-r border-line-subtle transition-colors duration-120",
        isToday ? "bg-surface-today" : "bg-surface hover:bg-surface-column-hover",
        highlighted && DROP_HIGHLIGHT,
      )}
    >
      <h2
        className={cn(
          "flex items-baseline gap-[7px] border-b border-line-subtle px-3.5 pt-[11px] pb-2.5",
          isToday && "shadow-[inset_0_2px_0_0_var(--color-brand)]",
        )}
      >
        <span className={cn("text-[13px] font-semibold", isToday ? "text-brand" : "text-ink")}>
          {label}
        </span>
        <span className={cn("font-mono text-[12px]", isToday ? "text-brand" : "text-meta-dim")}>
          {formatDateShort(date)}
        </span>
        {tasks.length > 0 ? (
          <span className="ml-auto font-mono text-[11px] font-medium text-counter">{tasks.length}</span>
        ) : null}
      </h2>
      <SortableContext
        items={tasks.map((t) => `${date}|${t.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-[7px] p-2 xl:p-2.5">
          {tasks.length === 0 ? (
            <p className="px-0.5 py-1.5 text-[11.5px] text-faint">Нет запланированных работ</p>
          ) : (
            tasks.map((task) => (
              <SortableTaskChip key={task.id} projectId={projectId} date={date} task={task} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Защита от системного меню долгого нажатия на ссылку (iOS) и выделения текста при перетаскивании.
const DRAGGABLE_CLASS = "touch-manipulation select-none [-webkit-touch-callout:none]";

function SortableTaskChip({ projectId, date, task }: { projectId: string; date: string; task: DayTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${date}|${task.id}`,
    data: { container: date, taskId: task.id, title: task.title } satisfies DragData,
  });

  return (
    <TaskChip
      ref={setNodeRef}
      projectId={projectId}
      task={task}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...dragAttributes(attributes)}
      {...dragListeners(listeners)}
      className={cn(DRAGGABLE_CLASS, isDragging && "opacity-40")}
    />
  );
}

function BacklogPanel({
  projectId,
  tasks,
  categories,
  highlighted,
}: {
  projectId: string;
  tasks: BacklogTask[];
  categories: { id: string; name: string }[];
  highlighted: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG, data: { container: BACKLOG } satisfies DragData });

  return (
    <div ref={setNodeRef} className="flex min-w-0">
      <Panel className={cn("flex-1 transition-shadow duration-120", highlighted && DROP_HIGHLIGHT)}>
        <PanelHeader icon={<BookmarkIcon />} title="Текущие заявки" count={tasks.length} />
        <CreateTaskForm projectId={projectId} categories={categories} />
        {tasks.length === 0 ? (
          <PanelEmpty>Нет текущих заявок</PanelEmpty>
        ) : (
          <div className="flex flex-col p-1.5">
            {tasks.map((task) => (
              <DraggableTaskRow key={task.id} projectId={projectId} task={task} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// «Текущие заявки» упорядочены по дате создания, позиции у них нет — строки
// только перетаскиваются в дни, а не сортируются внутри панели.
function DraggableTaskRow({ projectId, task }: { projectId: string; task: BacklogTask }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${BACKLOG}|${task.id}`,
    data: { container: BACKLOG, taskId: task.id, title: task.title } satisfies DragData,
  });

  return (
    <TaskRow
      ref={setNodeRef}
      projectId={projectId}
      task={task}
      {...dragAttributes(attributes)}
      {...dragListeners(listeners)}
      className={cn(DRAGGABLE_CLASS, isDragging && "opacity-40")}
    />
  );
}
