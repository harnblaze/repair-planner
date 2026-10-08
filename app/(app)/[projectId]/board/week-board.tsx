"use client";

import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
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
import {
  moveTaskBetweenQueues,
  queueDropIndex,
  queueIdOf,
  queueKey,
} from "@/lib/business/backlog-queues";
import { formatDateLong, formatDateShort } from "@/lib/business/dates";
import {
  canCarryOverFromBoard,
  canPlanOnDate,
  canReturnToBacklog,
  keepsDayOnReturnToBacklog,
} from "@/lib/business/task-planning";
import { weekdayLabel } from "@/lib/business/working-days";
import type { ActionResult } from "@/lib/types/action-result";
import { cn } from "@/lib/utils";

import {
  moveBacklogTaskAction,
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
import { CarryOverChipButton } from "./carry-over-chip-button";
import { TaskChip, TaskRow, type BoardTask } from "./task-chip";

// Неделя доски и панели очередей текущих заявок в одном DndContext: задачу
// можно запланировать, сменить ей день, упорядочить внутри дня или очереди,
// перенести в другую очередь и вернуть с доски. Правила —
// lib/business/task-planning.ts и lib/business/backlog-queues.ts, окончательная
// проверка — RPC supabase/migrations/0008, 0018. Интерфейс обновляется сразу
// (useOptimistic); при ошибке сервера состояние само возвращается к данным сервера.

export type DayTask = BoardTask & { canChangeDay: boolean; queueId: string | null };
export type BacklogTask = BoardTask & { lastWorkDate: string | null; queueId: string | null };
/** Панель очереди: id null — «Текущие заявки». */
export type BoardQueue = { id: string | null; name: string; tasks: BacklogTask[] };

const QUEUE_PREFIX = "queue:";
const queueContainer = (key: string) => `${QUEUE_PREFIX}${key}`;
const isQueueContainer = (container: string) => container.startsWith(QUEUE_PREFIX);
const queueKeyOfContainer = (container: string) => container.slice(QUEUE_PREFIX.length);

/** queues — заявки панелей по ключу очереди (lib/business/backlog-queues.ts::queueKey). */
type BoardState = { days: Record<string, DayTask[]>; queues: Record<string, BacklogTask[]> };

/** container — дата "YYYY-MM-DD" или "queue:<ключ>"; taskId отсутствует у самой колонки. */
type DragData = { container: string; taskId?: string; title?: string };

type Move =
  | { type: "reorder"; date: string; from: number; to: number }
  | { type: "changeDay"; taskId: string; fromDate: string; toDate: string; index: number }
  | { type: "plan"; taskId: string; fromQueue: string; toDate: string; index: number }
  | { type: "toBacklog"; taskId: string; today: string }
  | { type: "moveInQueues"; taskId: string; fromQueue: string; toQueue: string; index: number };

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
      const source = state.queues[move.fromQueue] ?? [];
      const task = source.find((t) => t.id === move.taskId);
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
        queues: { ...state.queues, [move.fromQueue]: source.filter((t) => t.id !== move.taskId) },
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

      // Заявка возвращается наверх своей очереди.
      const key = queueKey(task.queueId);
      return {
        days,
        queues: {
          ...state.queues,
          [key]: [
            { ...task, isHistory: false, transferNote: null, lastWorkDate: lastKept },
            ...(state.queues[key] ?? []),
          ],
        },
      };
    }

    case "moveInQueues":
      return {
        ...state,
        queues: moveTaskBetweenQueues(state.queues, move.taskId, move.fromQueue, move.toQueue, move.index),
      };
  }
}

type DropVerdict = { ok: true } | { ok: false; reason: string } | null;

const HISTORY_REASON = "Это день из истории заявки — его можно только упорядочить внутри дня.";

const dayOffReason = (date: string) => `${formatDateLong(date)} — нерабочий день.`;

/**
 * null — перемещение ничего не меняет; ok: false — запрещено с понятной причиной.
 * daysOff — нерабочие дни недели: в них нельзя планировать, но задачи, которые
 * уже там стоят, можно упорядочить (supabase/migrations/0013).
 */
function checkDrop(
  state: BoardState,
  from: DragData,
  target: string,
  daysOff: Record<string, string>,
): DropVerdict {
  if (isQueueContainer(from.container)) {
    const task = state.queues[queueKeyOfContainer(from.container)]?.find((t) => t.id === from.taskId);
    if (!task) return null;
    // Внутри очереди и между очередями; «ничего не изменилось» решает onDragEnd.
    if (isQueueContainer(target)) return { ok: true };
    if (target in daysOff) return { ok: false, reason: dayOffReason(target) };
    return canPlanOnDate(task.lastWorkDate, target)
      ? { ok: true }
      : {
          ok: false,
          reason: `Заявку уже вели до ${formatDateLong(task.lastWorkDate!)} — запланируйте её не раньше этого дня.`,
        };
  }

  const task = state.days[from.container]?.find((t) => t.id === from.taskId);
  if (!task) return null;

  if (isQueueContainer(target)) {
    if (task.isHistory) return { ok: false, reason: HISTORY_REASON };
    if (!canReturnToBacklog(task.status)) {
      return { ok: false, reason: "Завершённую или отменённую заявку нельзя вернуть в текущие заявки." };
    }
    if (queueKeyOfContainer(target) !== queueKey(task.queueId)) {
      return {
        ok: false,
        reason: "Заявка возвращается в свою очередь. Перенести её в другую можно из панели очереди.",
      };
    }
    return { ok: true };
  }

  if (target === from.container) return { ok: true };
  if (task.isHistory) return { ok: false, reason: HISTORY_REASON };
  if (target in daysOff) return { ok: false, reason: dayOffReason(target) };
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
  daysOff,
  days,
  queues,
  categories,
  canEdit,
  children,
}: {
  projectId: string;
  today: string;
  /** Пн–Пт и рабочая суббота (lib/business/working-days.ts::weekBoardDays). */
  weekDates: string[];
  /** Нерабочие дни недели: дата → подпись («Новогодние каникулы», «Выходной»). */
  daysOff: Record<string, string>;
  days: Record<string, DayTask[]>;
  /** Панели очередей в порядке показа: первая — «Текущие заявки». */
  queues: BoardQueue[];
  categories: { id: string; name: string }[];
  /** false — только просмотр: без перетаскивания и формы создания. */
  canEdit: boolean;
  /** Остальные панели нижнего ряда — дополнительные списки. */
  children: React.ReactNode;
}) {
  const dndId = useId();
  const sensors = useBoardSensors();
  const clicks = useSuppressClickAfterDrag();
  const [, startTransition] = useTransition();

  const serverState = useMemo<BoardState>(
    () => ({ days, queues: Object.fromEntries(queues.map((q) => [queueKey(q.id), q.tasks])) }),
    [days, queues],
  );
  const [board, applyOptimistic] = useOptimistic(serverState, applyMove);

  const [active, setActive] = useState<DragData | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);

  const dropAllowed = (container: string) =>
    active !== null && overContainer === container && checkDrop(board, active, container, daysOff)?.ok === true;

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
    const verdict = checkDrop(board, from, to.container, daysOff);

    if (verdict === null) return;
    if (!verdict.ok) {
      toast.error(verdict.reason);
      return;
    }

    // Перетаскиваемая карточка ниже середины того, над чем её отпустили: строки
    // (вставка после неё) или самой панели очереди (в конец, а не наверх).
    const translated = dragged.rect.current.translated;
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;

    if (isQueueContainer(to.container)) {
      if (!isQueueContainer(from.container)) {
        run({ type: "toBacklog", taskId, today }, () => returnTaskToBacklogAction(projectId, taskId));
        return;
      }
      const fromQueue = queueKeyOfContainer(from.container);
      const toQueue = queueKeyOfContainer(to.container);
      const target = board.queues[toQueue] ?? [];
      const index = queueDropIndex(target, taskId, to.taskId ?? null, below);
      if (fromQueue === toQueue && target.findIndex((t) => t.id === taskId) === index) return;
      run({ type: "moveInQueues", taskId, fromQueue, toQueue, index }, () =>
        moveBacklogTaskAction(projectId, { taskId, queueId: queueIdOf(toQueue), position: index }),
      );
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

    const index = overIndex === -1 ? list.length : overIndex + (below ? 1 : 0);

    if (isQueueContainer(from.container)) {
      run({ type: "plan", taskId, fromQueue: queueKeyOfContainer(from.container), toDate, index }, () =>
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
      : isQueueContainer(active.container)
        ? board.queues[queueKeyOfContainer(active.container)]?.find((t) => t.id === active.taskId)
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
        {/* Неделя — ряд из пяти колонок (шести с рабочей субботой) на всю ширину,
            без прокрутки и без переноса (docs/redesign.md §4). minmax(0,1fr)
            обязателен: иначе длинный заголовок задачи распирает колонку.
            До md (макет — только desktop) дни идут вертикальным списком. */}
        <section className="overflow-hidden rounded-[10px] border border-line-strong bg-surface">
          <div
            className={cn(
              "grid grid-cols-1",
              weekDates.length > 5
                ? "md:grid-cols-[repeat(6,minmax(0,1fr))]"
                : "md:grid-cols-[repeat(5,minmax(0,1fr))]",
            )}
          >
            {weekDates.map((date) => (
              <DayColumn
                key={date}
                projectId={projectId}
                date={date}
                label={weekdayLabel(date)}
                dayOff={daysOff[date] ?? null}
                isToday={date === today}
                tasks={board.days[date] ?? []}
                highlighted={dropAllowed(date)}
                canEdit={canEdit}
              />
            ))}
          </div>
        </section>

        {/* Панели очередей текущих заявок (основная и дополнительные), затем
            board_lists (стандартные и пользовательские) — по четыре панели в ряду под
            неделей (до lg — по две, до sm — по одной); списки сверх ряда
            переносятся на следующий. */}
        <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))] xl:gap-3.5">
          {queues.map((queue) => {
            const key = queueKey(queue.id);
            return (
              <QueuePanel
                key={key}
                projectId={projectId}
                queueId={queue.id}
                name={queue.name}
                tasks={board.queues[key] ?? []}
                categories={categories}
                highlighted={dropAllowed(queueContainer(key))}
                canEdit={canEdit}
              />
            );
          })}
          {children}
        </section>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && active ? (
          isQueueContainer(active.container) ? (
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
  dayOff,
  isToday,
  tasks,
  highlighted,
  canEdit,
}: {
  projectId: string;
  date: string;
  label: string;
  /** Подпись нерабочего дня или null для рабочего. */
  dayOff: string | null;
  isToday: boolean;
  tasks: DayTask[];
  highlighted: boolean;
  canEdit: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `day:${date}`, data: { container: date } satisfies DragData });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-24 min-w-0 flex-col border-b border-line-subtle transition-colors duration-120 last:border-b-0 md:min-h-[216px] md:border-r md:border-b-0",
        dayOff !== null
          ? "bg-page"
          : isToday
            ? "bg-surface-today"
            : "bg-surface hover:bg-surface-column-hover",
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
      {dayOff !== null ? (
        <p
          className="truncate border-b border-line-subtle px-3.5 py-1.5 text-[11.5px] font-medium text-status-warn-fg"
          title={dayOff}
        >
          {dayOff}
        </p>
      ) : null}
      <SortableContext
        items={tasks.map((t) => `${date}|${t.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-[7px] p-2 xl:p-2.5">
          {tasks.length === 0 ? (
            <p className="px-0.5 py-1.5 text-[11.5px] text-faint">
              {dayOff !== null ? "Работы не планируются" : "Нет запланированных работ"}
            </p>
          ) : (
            tasks.map((task) => (
              <SortableTaskChip
                key={task.id}
                projectId={projectId}
                date={date}
                task={task}
                canEdit={canEdit}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Защита от системного меню долгого нажатия на ссылку (iOS) и выделения текста при перетаскивании.
const DRAGGABLE_CLASS = "touch-manipulation select-none [-webkit-touch-callout:none]";

function SortableTaskChip({
  projectId,
  date,
  task,
  canEdit,
}: {
  projectId: string;
  date: string;
  task: DayTask;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${date}|${task.id}`,
    data: { container: date, taskId: task.id, title: task.title } satisfies DragData,
    disabled: !canEdit,
  });

  if (!canEdit) {
    return <TaskChip projectId={projectId} task={task} />;
  }

  const canCarryOver = canCarryOverFromBoard(task, canEdit);

  // Сдвиг при перетаскивании — на обёртке, чтобы кнопка переноса ехала вместе
  // с карточкой; слушатели перетаскивания — только на ссылке, кнопку они не задевают.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group relative", isDragging && "opacity-40")}
    >
      <TaskChip
        projectId={projectId}
        task={task}
        reserveCorner={canCarryOver}
        {...dragAttributes(attributes)}
        {...dragListeners(listeners)}
        className={DRAGGABLE_CLASS}
      />
      {canCarryOver && !isDragging ? <CarryOverChipButton projectId={projectId} taskId={task.id} /> : null}
    </div>
  );
}

function QueuePanel({
  projectId,
  queueId,
  name,
  tasks,
  categories,
  highlighted,
  canEdit,
}: {
  projectId: string;
  /** null — «Текущие заявки». */
  queueId: string | null;
  name: string;
  tasks: BacklogTask[];
  categories: { id: string; name: string }[];
  highlighted: boolean;
  canEdit: boolean;
}) {
  const container = queueContainer(queueKey(queueId));
  const { setNodeRef } = useDroppable({ id: container, data: { container } satisfies DragData });

  return (
    <div ref={setNodeRef} className="flex min-w-0">
      <Panel className={cn("flex-1 transition-shadow duration-120", highlighted && DROP_HIGHLIGHT)}>
        <PanelHeader icon={<BookmarkIcon />} title={name} count={tasks.length} />
        {canEdit ? <CreateTaskForm projectId={projectId} queueId={queueId} categories={categories} /> : null}
        {tasks.length === 0 ? (
          <PanelEmpty>{queueId === null ? "Нет текущих заявок" : "Нет заявок"}</PanelEmpty>
        ) : (
          <SortableContext
            items={tasks.map((t) => `${container}|${t.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col p-1.5">
              {tasks.map((task) => (
                <SortableTaskRow
                  key={task.id}
                  projectId={projectId}
                  container={container}
                  task={task}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </Panel>
    </div>
  );
}

// Порядок в очереди ручной (tasks.backlog_position, 0018): строки сортируются
// внутри панели, переносятся в другие очереди и в дни.
function SortableTaskRow({
  projectId,
  container,
  task,
  canEdit,
}: {
  projectId: string;
  container: string;
  task: BacklogTask;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${container}|${task.id}`,
    data: { container, taskId: task.id, title: task.title } satisfies DragData,
    disabled: !canEdit,
  });

  if (!canEdit) {
    return <TaskRow projectId={projectId} task={task} />;
  }

  return (
    <TaskRow
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
