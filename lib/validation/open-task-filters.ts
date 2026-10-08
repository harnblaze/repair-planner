import { idSchema } from "./board-move";
import { firstParam, parseParam, parseSearchText, type SearchParams } from "./search-params";

// Фильтры вкладки «Открытые» страницы «Заявки» живут в URL: цех и текст.

export type OpenTaskFilters = {
  q: string;
  category: string | null;
};

export const DEFAULT_OPEN_TASK_FILTERS: OpenTaskFilters = { q: "", category: null };

export function parseOpenTaskFilters(params: SearchParams): OpenTaskFilters {
  return {
    q: parseSearchText(params.q),
    category: parseParam(idSchema, firstParam(params.category), null),
  };
}

/** Query-строка вкладки «Открытые»; без фильтров — пустая строка. */
export function openTasksQuery(filters: OpenTaskFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  return params.toString();
}

export function hasOpenTaskFilters(filters: OpenTaskFilters): boolean {
  return filters.q !== "" || filters.category !== null;
}
