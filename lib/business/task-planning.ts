// Правила переноса задачи между рабочими днями (CLAUDE.md §27, §26).
// Само вычисление следующего рабочего дня — в working-days.ts, здесь только
// бизнес-правила о том, когда перенос уместен и как его показывать.

import type { TaskStatus } from "./task-status";

const NON_TRANSFERABLE_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

/** Переносить имеет смысл только незавершённую задачу. */
export function canCarryOverTask(status: TaskStatus): boolean {
  return !NON_TRANSFERABLE_STATUSES.includes(status);
}

/**
 * true, если это не последний день работы над задачей — т.е. позже был перенос.
 * `plannedDate` — кеш максимальной `work_date` из `task_schedule` (см. database.md §5.7),
 * поэтому расхождение с `workDate` конкретного дня однозначно указывает на перенос.
 */
export function isCarriedOverOccurrence(workDate: string, plannedDate: string | null): boolean {
  return plannedDate !== null && workDate !== plannedDate;
}
