// Лента проекта: что произошло, когда и кем. События пишет база (триггеры
// 0032_project_activity), приложение только собирает фразу из payload —
// поэтому в payload лежит снимок названий на момент события, и переименование
// заявки не переписывает историю.

import type { Database } from "@/lib/types/database";

import { movementLabel, type MovementKind } from "./material-movements";
import { projectRoleLabel, type ProjectRole } from "./project-roles";
import { formatDateShort } from "./dates";
import { taskStatusLabel, type TaskStatus } from "./task-status";

export type CalendarDayKind = Database["public"]["Enums"]["calendar_day_kind"];

/**
 * Контракт payload по видам событий. Поля необязательны: payload — jsonb,
 * и старые записи могли появиться до расширения триггера. Каждая подпись
 * ниже переживает отсутствующее поле, подставляя понятную заглушку.
 */
export type ActivityPayloads = {
  "task.created": { title?: string };
  "task.status": { title?: string; from?: TaskStatus; to?: TaskStatus };
  "task.returned_to_backlog": { title?: string };
  "task.executor.added": { task?: string; executor?: string };
  "task.executor.removed": { task?: string; executor?: string };
  "task.carried_over": { task?: string; from_date?: string; to_date?: string };
  "item.created": { title?: string; list?: string };
  "item.deleted": { title?: string; list?: string };
  "item.done": { title?: string; list?: string };
  "item.reopened": { title?: string; list?: string };
  "material.moved": { material?: string; unit?: string; kind?: MovementKind; quantity?: number; task?: string };
  "material.created": { name?: string };
  "material.archived": { name?: string };
  "material.restored": { name?: string };
  "category.created": { name?: string };
  "category.archived": { name?: string };
  "category.restored": { name?: string };
  "executor.created": { name?: string };
  "executor.archived": { name?: string };
  "executor.restored": { name?: string };
  "list.created": { name?: string };
  "list.renamed": { name?: string; from?: string };
  "list.deleted": { name?: string };
  "queue.created": { name?: string };
  "queue.renamed": { name?: string; from?: string };
  "queue.deleted": { name?: string };
  "calendar.day_added": { day?: string; kind?: CalendarDayKind };
  "calendar.day_removed": { day?: string; kind?: CalendarDayKind };
  "member.joined": { full_name?: string; role?: ProjectRole };
  "member.left": { full_name?: string; role?: ProjectRole };
  "member.role_changed": { full_name?: string; role?: ProjectRole; from?: ProjectRole };
  "invitation.created": { role?: ProjectRole };
  "invitation.revoked": { role?: ProjectRole };
};

export type ActivityKind = keyof ActivityPayloads;

/** Строка журнала в том виде, в каком её отдаёт БД. */
export type ActivityRow = {
  id: number;
  actor_id: string | null;
  kind: string;
  entity_type: string;
  entity_id: string | null;
  payload: unknown;
  created_at: string;
};

const FALLBACK = "—";

function text(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : FALLBACK;
}

function inQuotes(value: string | undefined): string {
  return `«${text(value)}»`;
}

function quantity(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return FALLBACK;
  // Число, а не строка: разделитель разрядов здесь не нужен, но хвостовые нули
  // из numeric(14,3) убираем — «2,5», а не «2,500».
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

function day(value: string | undefined): string {
  if (!value) return FALLBACK;
  // payload приходит как date (YYYY-MM-DD); formatDateShort ждёт такой же вид.
  return formatDateShort(value.slice(0, 10));
}

function status(value: TaskStatus | undefined): string {
  return value ? taskStatusLabel(value) : FALLBACK;
}

function role(value: ProjectRole | undefined): string {
  return value ? projectRoleLabel(value) : FALLBACK;
}

function calendarKind(value: CalendarDayKind | undefined): string {
  return value === "holiday" ? "нерабочим" : "рабочим";
}

/** «2,5 кг»: единица есть только у материала, известного справочнику. */
function measured(value: number | undefined, unit: string | undefined): string {
  const number = quantity(value);
  return unit ? `${number} ${unit}` : number;
}

type Describer<K extends ActivityKind> = (payload: ActivityPayloads[K]) => string;

const DESCRIBERS: { [K in ActivityKind]: Describer<K> } = {
  "task.created": (p) => `создана заявка ${inQuotes(p.title)}`,
  "task.status": (p) =>
    `заявка ${inQuotes(p.title)}: ${status(p.from)} → ${status(p.to)}`,
  "task.returned_to_backlog": (p) => `заявка ${inQuotes(p.title)} возвращена в «Текущие заявки»`,
  "task.executor.added": (p) =>
    `на заявку ${inQuotes(p.task)} назначен исполнитель ${text(p.executor)}`,
  "task.executor.removed": (p) =>
    `с заявки ${inQuotes(p.task)} снят исполнитель ${text(p.executor)}`,
  "task.carried_over": (p) =>
    `заявка ${inQuotes(p.task)} перенесена с ${day(p.from_date)} на ${day(p.to_date)}`,

  "item.created": (p) =>
    p.list ? `в списке ${inQuotes(p.list)} новый пункт ${inQuotes(p.title)}` : `новый пункт ${inQuotes(p.title)}`,
  "item.deleted": (p) =>
    p.list ? `из списка ${inQuotes(p.list)} удалён пункт ${inQuotes(p.title)}` : `удалён пункт ${inQuotes(p.title)}`,
  "item.done": (p) => `пункт ${inQuotes(p.title)} отмечен выполненным`,
  "item.reopened": (p) => `пункт ${inQuotes(p.title)} возвращён в работу`,

  "material.moved": (p) => {
    // movementLabel различает только наличие заявки (правка расхода ≠ ручная
    // корректировка), поэтому вторым аргументом идёт признак, а не id.
    const kind = p.kind ? movementLabel(p.kind, p.task ? "task" : null).toLowerCase() : "движение";
    // Единица — из payload: это снимок, он переживает удаление материала.
    const task = p.task ? ` (заявка ${inQuotes(p.task)})` : "";
    return `материал ${inQuotes(p.material)}: ${kind} ${measured(p.quantity, p.unit)}${task}`;
  },
  "material.created": (p) => `новый материал ${inQuotes(p.name)}`,
  "material.archived": (p) => `материал ${inQuotes(p.name)} в архиве`,
  "material.restored": (p) => `материал ${inQuotes(p.name)} возвращён из архива`,

  "category.created": (p) => `новый цех ${inQuotes(p.name)}`,
  "category.archived": (p) => `цех ${inQuotes(p.name)} в архиве`,
  "category.restored": (p) => `цех ${inQuotes(p.name)} возвращён из архива`,

  "executor.created": (p) => `новый исполнитель ${inQuotes(p.name)}`,
  "executor.archived": (p) => `исполнитель ${inQuotes(p.name)} в архиве`,
  "executor.restored": (p) => `исполнитель ${inQuotes(p.name)} возвращён из архива`,

  "list.created": (p) => `новый список ${inQuotes(p.name)}`,
  "list.renamed": (p) => `список ${inQuotes(p.from)} переименован в ${inQuotes(p.name)}`,
  "list.deleted": (p) => `список ${inQuotes(p.name)} удалён`,

  "queue.created": (p) => `новая очередь ${inQuotes(p.name)}`,
  "queue.renamed": (p) => `очередь ${inQuotes(p.from)} переименована в ${inQuotes(p.name)}`,
  "queue.deleted": (p) => `очередь ${inQuotes(p.name)} удалена`,

  "calendar.day_added": (p) => `день ${day(p.day)} отмечен ${calendarKind(p.kind)}`,
  "calendar.day_removed": (p) => `исключение на ${day(p.day)} снято`,

  "member.joined": (p) => `в проект добавлен участник ${text(p.full_name)} — ${role(p.role)}`,
  "member.left": (p) => `проект покинул участник ${text(p.full_name)}`,
  "member.role_changed": (p) =>
    `роль участника ${text(p.full_name)}: ${role(p.from)} → ${role(p.role)}`,

  "invitation.created": (p) => `создано приглашение в проект — ${role(p.role)}`,
  "invitation.revoked": () => `приглашение отозвано`,
};

/** Все виды событий — для теста синхронности со списком в миграции и для фильтров. */
export const ACTIVITY_KINDS = Object.keys(DESCRIBERS) as ActivityKind[];

export function isActivityKind(value: string): value is ActivityKind {
  return Object.hasOwn(DESCRIBERS, value);
}

/**
 * Русская фраза события. Одна на строку ленты: автора подставляет страница
 * отдельно, поэтому формулировки безличные — род автора не важен.
 */
export function describeActivity(kind: ActivityKind, payload: unknown): string {
  const describe = DESCRIBERS[kind] as (p: unknown) => string;
  return describe(payload ?? {});
}

/** Фраза для строки из БД: неизвестный вид (старый код, новая миграция) не роняет ленту. */
export function describeRow(row: ActivityRow): string {
  if (!isActivityKind(row.kind)) return `изменение (${row.kind})`;
  return describeActivity(row.kind, row.payload);
}

/** Куда ведёт строка ленты. Объект мог быть удалён — тогда ссылки нет. */
export function activityHref(projectId: string, row: ActivityRow): string | null {
  const id = row.entity_id;
  switch (row.entity_type) {
    case "task":
      return id ? `/${projectId}/tasks/${id}` : null;
    case "material":
      return id ? `/${projectId}/materials/${id}` : null;
    case "category":
      return `/${projectId}/categories`;
    case "executor":
      return `/${projectId}/executors`;
    case "board_item":
    case "board_list":
      return `/${projectId}/board`;
    case "task_queue":
      return `/${projectId}/board`;
    case "calendar_day":
      return `/${projectId}/settings/calendar`;
    case "project_member":
    case "project_invitation":
      return `/${projectId}/settings`;
    default:
      return null;
  }
}

/** Дата события в timezone проекта: «2026-11-05». */
export function activityDay(isoTimestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Время события в timezone проекта: «14:32». */
export function activityTime(isoTimestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

/**
 * Заголовок группы: «Сегодня», «Вчера» или дата. Сегодняшнюю дату передаём
 * снаружи (todayInTimezone), чтобы функция осталась чистой и тестируемой.
 */
export function activityDayLabel(day: string, today: string, previousDay: string): string {
  if (day === today) return "Сегодня";
  if (day === previousDay) return "Вчера";
  return formatDateShort(day);
}

export type ActivityGroup = { day: string; label: string; rows: ActivityRow[] };

/** Группировка по дням с сохранением порядка «сначала новые». */
export function groupByDay(
  rows: ActivityRow[],
  timezone: string,
  today: string,
  previousDay: string,
): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const row of rows) {
    const day = activityDay(row.created_at, timezone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.rows.push(row);
    } else {
      groups.push({ day, label: activityDayLabel(day, today, previousDay), rows: [row] });
    }
  }
  return groups;
}
