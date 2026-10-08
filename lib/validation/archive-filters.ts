import { z } from "zod";

import { isValidDateString } from "@/lib/business/working-days";

import { idSchema } from "./board-move";

// Фильтры вкладки «Архив» страницы «Заявки» живут в URL
// (docs/superpowers/specs/2026-10-08-task-archive-search-design.md §4.1).
// Адрес могли отредактировать руками: неверное поле молча получает значение
// по умолчанию, остальные поля не страдают.

export const ARCHIVE_STATUSES = ["completed", "cancelled", "all"] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const ARCHIVE_QUERY_MAX = 100;
export const ARCHIVE_PAGE_SIZE = 50;
export const ARCHIVE_MAX_PAGE = 20;

export type ArchiveFilters = {
  q: string;
  status: ArchiveStatus;
  category: string | null;
  executor: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  q: "",
  status: "completed",
  category: null,
  executor: null,
  from: null,
  to: null,
  page: 1,
};

type SearchParams = Record<string, string | string[] | undefined>;

const statusSchema = z.enum(ARCHIVE_STATUSES);
const dateSchema = z.string().refine(isValidDateString);
const pageSchema = z.coerce.number().int().min(1).max(ARCHIVE_MAX_PAGE);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T, F>(schema: z.ZodType<T>, value: unknown, fallback: F): T | F {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

export function parseArchiveFilters(params: SearchParams): ArchiveFilters {
  let from = pick(dateSchema, first(params.from), null);
  let to = pick(dateSchema, first(params.to), null);
  if (from !== null && to !== null && from > to) [from, to] = [to, from];

  return {
    q: (first(params.q) ?? "").trim().slice(0, ARCHIVE_QUERY_MAX),
    status: pick(statusSchema, first(params.status), DEFAULT_ARCHIVE_FILTERS.status),
    category: pick(idSchema, first(params.category), null),
    executor: pick(idSchema, first(params.executor), null),
    from,
    to,
    page: pick(pageSchema, first(params.page), 1),
  };
}

/** Query-строка вкладки архива; поля со значением по умолчанию опускаются. */
export function archiveQuery(filters: ArchiveFilters, overrides: Partial<ArchiveFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams({ view: "archive" });
  if (f.q) params.set("q", f.q);
  if (f.status !== DEFAULT_ARCHIVE_FILTERS.status) params.set("status", f.status);
  if (f.category) params.set("category", f.category);
  if (f.executor) params.set("executor", f.executor);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.page > 1) params.set("page", String(f.page));
  return params.toString();
}

/** Задан ли хоть один фильтр (номер страницы — не фильтр). */
export function hasArchiveFilters(f: ArchiveFilters): boolean {
  return (
    f.q !== "" ||
    f.status !== DEFAULT_ARCHIVE_FILTERS.status ||
    f.category !== null ||
    f.executor !== null ||
    f.from !== null ||
    f.to !== null
  );
}
