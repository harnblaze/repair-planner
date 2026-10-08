import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SEARCH_QUERY_MAX } from "@/lib/validation/search-params";
import { hasOpenTaskFilters, openTasksQuery, type OpenTaskFilters } from "@/lib/validation/open-task-filters";

/** Фильтры вкладки «Открытые» — GET-форма, как у архива: состояние в URL, без клиентского JS. */
export function OpenTasksFiltersForm({
  projectId,
  filters,
  categories,
}: {
  projectId: string;
  filters: OpenTaskFilters;
  categories: { id: string; name: string; is_archived: boolean }[];
}) {
  const base = `/${projectId}/tasks`;

  return (
    // key: после перехода по ссылке («Сбросить», вкладка) поля показывают значения нового URL.
    <form
      key={openTasksQuery(filters)}
      method="get"
      action={base}
      role="search"
      className="flex flex-wrap items-center gap-2"
    >
      <Input
        type="search"
        name="q"
        defaultValue={filters.q}
        maxLength={SEARCH_QUERY_MAX}
        placeholder="Название или описание"
        aria-label="Поиск открытых заявок"
        className="basis-full sm:basis-0 sm:flex-1"
      />
      <NativeSelect
        name="category"
        aria-label="Цех"
        defaultValue={filters.category ?? ""}
        wrapperClassName="min-w-0 flex-1 sm:flex-initial"
      >
        <option value="">Все цеха</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.is_archived ? `${c.name} (архив)` : c.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline">
        Найти
      </Button>
      {hasOpenTaskFilters(filters) ? (
        <Link href={base} className="text-[12.5px] text-meta transition-colors duration-120 hover:text-ink">
          Сбросить
        </Link>
      ) : null}
    </form>
  );
}
