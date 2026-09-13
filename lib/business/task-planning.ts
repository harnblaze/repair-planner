// Правила переноса задачи между рабочими днями (CLAUDE.md §27, §26).
// Само вычисление следующего рабочего дня — в working-days.ts, здесь только
// бизнес-правила о том, когда перенос/перемещение уместны и как их показывать.
// Правила перемещения дублируют проверки RPC из supabase/migrations/0008 —
// БД остаётся источником истины, здесь они нужны для мгновенного отклика доски.

import { formatDateLong } from "./dates";
import type { TaskStatus } from "./task-status";

const NON_TRANSFERABLE_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

/** Переносить имеет смысл только незавершённую задачу. */
export function canCarryOverTask(status: TaskStatus): boolean {
  return !NON_TRANSFERABLE_STATUSES.includes(status);
}

/** Вернуть в «Текущие заявки» можно только незавершённую задачу — те же статусы, что и для переноса. */
export const canReturnToBacklog = canCarryOverTask;

/**
 * Останется ли день в истории при возврате задачи в «Текущие заявки»
 * (public.return_task_to_backlog). Если работа не начиналась (new/planned) —
 * все дни были только планом. Если задача в работе или приостановлена —
 * дни до сегодняшнего включительно остаются, будущие удаляются.
 */
export function keepsDayOnReturnToBacklog(
  status: TaskStatus,
  workDate: string,
  today: string,
): boolean {
  return (status === "in_progress" || status === "paused") && workDate <= today;
}

/** Можно ли запланировать задачу из «Текущих заявок» на день: не раньше последнего дня истории. */
export function canPlanOnDate(lastWorkDate: string | null, workDate: string): boolean {
  return lastWorkDate === null || workDate >= lastWorkDate;
}

export type ScheduleDay = { workDate: string; postponed: boolean };

export type Occurrence = {
  /** День — история: после него задачу перенесли или отложили. */
  isHistory: boolean;
  /** Пояснение для исторического дня: «Перенесена на …» / «Отложена». */
  note: string | null;
  /** Перетаскивание на другой день: только однодневная задача в своём текущем дне. */
  canChangeDay: boolean;
};

/**
 * Описание одного дня работы над задачей на доске.
 * `plannedDate` — текущий плановый день (null, если задача отложена),
 * `days` — все дни расписания задачи.
 */
export function describeOccurrence(
  workDate: string,
  plannedDate: string | null,
  days: ScheduleDay[],
): Occurrence {
  const isHistory = workDate !== plannedDate;

  if (!isHistory) {
    return { isHistory, note: null, canChangeDay: days.length === 1 };
  }

  const day = days.find((d) => d.workDate === workDate);
  const next = days
    .map((d) => d.workDate)
    .filter((d) => d > workDate)
    .sort()[0];

  let note: string | null;
  if (day?.postponed) {
    note = next ? `Отложена, продолжена ${formatDateLong(next)}` : "Отложена";
  } else {
    note = next ? `Перенесена на ${formatDateLong(next)}` : null;
  }

  return { isHistory, note, canChangeDay: false };
}

/** Последний день расписания задачи или null, если дней нет. */
export function lastWorkDate(days: ScheduleDay[]): string | null {
  return days.reduce<string | null>((max, d) => (max === null || d.workDate > max ? d.workDate : max), null);
}
