import { z } from "zod";

import { isValidDateString } from "@/lib/business/working-days";

import { idSchema } from "./board-move";
import { SEARCH_QUERY_MAX, firstParam, parseParam, parseSearchText, type SearchParams } from "./search-params";

// Фильтры вкладки «Архив» страницы «Заявки» живут в URL
// (docs/superpowers/specs/2026-10-08-task-archive-search-design.md §4.1).
// Разбор — общими хелперами lib/validation/search-params.ts.

export const ARCHIVE_STATUSES = ["completed", "cancelled", "all"] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const ARCHIVE_QUERY_MAX = SEARCH_QUERY_MAX;
export const ARCHIVE_PAGE_SIZE = 50;
export const ARCHIVE_MAX_PAGE = 20;

export type ArchiveFilters = {
  q: string;
  status: ArchiveStatus;
  category: string | null;
  executor: string | null;
  /** Материал: только заявки, где он тратился, и расход в строке. */
  material: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  q: "",
  status: "completed",
  category: null,
  executor: null,
  material: null,
  from: null,
  to: null,
  page: 1,
};

const statusSchema = z.enum(ARCHIVE_STATUSES);
const dateSchema = z.string().refine(isValidDateString);
const pageSchema = z.coerce.number().int().min(1).max(ARCHIVE_MAX_PAGE);

export function parseArchiveFilters(params: SearchParams): ArchiveFilters {
  let from = parseParam(dateSchema, firstParam(params.from), null);
  let to = parseParam(dateSchema, firstParam(params.to), null);
  if (from !== null && to !== null && from > to) [from, to] = [to, from];

  return {
    q: parseSearchText(params.q),
    status: parseParam(statusSchema, firstParam(params.status), DEFAULT_ARCHIVE_FILTERS.status),
    category: parseParam(idSchema, firstParam(params.category), null),
    executor: parseParam(idSchema, firstParam(params.executor), null),
    material: parseParam(idSchema, firstParam(params.material), null),
    from,
    to,
    page: parseParam(pageSchema, firstParam(params.page), 1),
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
  if (f.material) params.set("material", f.material);
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
    f.material !== null ||
    f.from !== null ||
    f.to !== null
  );
}
