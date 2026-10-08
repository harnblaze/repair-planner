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

/**
 * Кнопка переноса на карточке доски: только в последнем дне задачи (дни из
 * истории уже перенесены) и только у того, кто может редактировать проект.
 */
export function canCarryOverFromBoard(
  task: { status: TaskStatus; isHistory?: boolean },
  canEdit: boolean,
): boolean {
  return canEdit && !task.isHistory && canCarryOverTask(task.status);
}

/** Кнопка «Завершить» на карточке доски — там же, где кнопка переноса (product-requirements.md §2). */
export const canCompleteFromBoard = canCarryOverFromBoard;

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

/**
 * Статус после снятия с плана (public.return_task_to_backlog и
 * set_task_planned_date(null), 0028): работа не начиналась — planned → new;
 * остальные статусы не меняются.
 */
export function statusAfterReturnToBacklog(status: TaskStatus): TaskStatus {
  return status === "planned" ? "new" : status;
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

/**
 * Можно ли отменить перенос (public.undo_carry_over, 0021): день — последний,
 * перед ним есть неотложенный день (значит, этот появился переносом), и он
 * ещё не прошёл. Даты — строки YYYY-MM-DD в timezone проекта.
 */
export function isUndoableCarryOver(
  workDate: string,
  plannedDate: string | null,
  days: ScheduleDay[],
  today: string,
): boolean {
  if (workDate !== plannedDate || workDate < today) return false;
  const previous = days
    .filter((d) => d.workDate < workDate)
    .reduce<ScheduleDay | null>((max, d) => (max === null || d.workDate > max.workDate ? d : max), null);
  return previous !== null && !previous.postponed;
}

/** Кнопка «↩» на карточке доски: отменяемый перенос открытой задачи, право редактирования. */
export function canUndoCarryOverFromBoard(
  task: { status: TaskStatus; isHistory?: boolean; undoableCarryOver?: boolean },
  canEdit: boolean,
): boolean {
  // isHistory — страховка для оптимистичного состояния доски: копия дня-истории
  // сохраняет флаг исходной карточки до обновления данных с сервера.
  return canEdit && !task.isHistory && Boolean(task.undoableCarryOver) && canCarryOverTask(task.status);
}

/** Последний день расписания задачи или null, если дней нет. */
export function lastWorkDate(days: ScheduleDay[]): string | null {
  return days.reduce<string | null>((max, d) => (max === null || d.workDate > max ? d.workDate : max), null);
}
