import type { TaskStatus } from "@/lib/business/task-status";

/** С скольки «сделанных» карточек в дне они сворачиваются в стопку. */
export const DONE_STACK_MIN = 2;

type DayTaskLike = { status: TaskStatus; isHistory?: boolean };

/**
 * Карточка «сделана» для стопки дня. Карточки-истории (перенесена, отложена)
 * в стопку не попадают — след переноса должен оставаться на виду.
 */
export function isDoneOnDay(task: DayTaskLike): boolean {
  return (
    !task.isHistory &&
    (task.status === "completed" || task.status === "cancelled")
  );
}

/**
 * Делит карточки дня на активные и «сделанные», сохраняя порядок в обеих
 * группах. Только для отображения: порядок в состоянии и позиции не меняются.
 */
export function splitDayTasks<T extends DayTaskLike>(
  tasks: T[],
): { active: T[]; done: T[]; stacked: boolean } {
  const active: T[] = [];
  const done: T[] = [];
  for (const task of tasks) (isDoneOnDay(task) ? done : active).push(task);
  return { active, done, stacked: done.length >= DONE_STACK_MIN };
}

/** Сколько раскрытых дней помнить: старые выпадают, хранилище не растёт. */
export const OPEN_DAYS_LIMIT = 30;

/** Список дней с раскрытой стопкой после нажатия; последний раскрытый — в конце. */
export function rememberOpenDay(days: string[], date: string, open: boolean): string[] {
  const rest = days.filter((d) => d !== date);
  return open ? [...rest, date].slice(-OPEN_DAYS_LIMIT) : rest;
}
