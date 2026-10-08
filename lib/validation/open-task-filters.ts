import { z } from "zod";

import type { TaskStatus } from "@/lib/business/task-status";

import { idSchema } from "./board-move";
import { firstParam, parseParam, parseSearchText, type SearchParams } from "./search-params";

/** Статусы вкладки «Открытые»: выполненные и отменённые — в архиве. */
export const OPEN_TASK_STATUSES = ["new", "planned", "in_progress", "paused"] as const satisfies readonly TaskStatus[];
export type OpenTaskStatus = (typeof OPEN_TASK_STATUSES)[number];

/** Значение фильтра для основной очереди «Текущие заявки» (tasks.queue_id is null). */
export const MAIN_QUEUE = "main";

export type OpenTaskFilters = {
  q: string;
  category: string | null;
  executor: string | null;
  status: OpenTaskStatus | null;
  /** MAIN_QUEUE, id своей очереди или null — все очереди. */
  queue: string | null;
};

export const DEFAULT_OPEN_TASK_FILTERS: OpenTaskFilters = {
  q: "",
  category: null,
  executor: null,
  status: null,
  queue: null,
};

const statusSchema = z.enum(OPEN_TASK_STATUSES);
const queueSchema = z.union([z.literal(MAIN_QUEUE), idSchema]);

// Неверное значение поля молча сбрасывается: URL правят руками, страница не должна ломаться.
export function parseOpenTaskFilters(params: SearchParams): OpenTaskFilters {
  return {
    q: parseSearchText(params.q),
    category: parseParam(idSchema, firstParam(params.category), null),
    executor: parseParam(idSchema, firstParam(params.executor), null),
    status: parseParam(statusSchema, firstParam(params.status), null),
    queue: parseParam(queueSchema, firstParam(params.queue), null),
  };
}

export function openTasksQuery(filters: OpenTaskFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.executor) params.set("executor", filters.executor);
  if (filters.status) params.set("status", filters.status);
  if (filters.queue) params.set("queue", filters.queue);
  return params.toString();
}

export function hasOpenTaskFilters(filters: OpenTaskFilters): boolean {
  return (
    filters.q !== "" ||
    filters.category !== null ||
    filters.executor !== null ||
    filters.status !== null ||
    filters.queue !== null
  );
}
