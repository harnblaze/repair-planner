import type { z } from "zod";

// Разбор searchParams страниц с фильтрами в URL (архив и открытые заявки).
// Адрес могли отредактировать руками: неверное поле молча получает значение
// по умолчанию, остальные поля не страдают.

export type SearchParams = Record<string, string | string[] | undefined>;

/** Максимальная длина текста поиска. */
export const SEARCH_QUERY_MAX = 100;

/** Повторяющийся параметр — берётся первый. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseParam<T, F>(schema: z.ZodType<T>, value: unknown, fallback: F): T | F {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** Текст поиска: первый параметр, без пробелов по краям, не длиннее SEARCH_QUERY_MAX. */
export function parseSearchText(value: string | string[] | undefined): string {
  return (firstParam(value) ?? "").trim().slice(0, SEARCH_QUERY_MAX);
}
