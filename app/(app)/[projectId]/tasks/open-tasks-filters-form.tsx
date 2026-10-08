import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { taskStatusLabel } from "@/lib/business/task-status";
import { SEARCH_QUERY_MAX } from "@/lib/validation/search-params";
import {
  MAIN_QUEUE,
  OPEN_TASK_STATUSES,
  hasOpenTaskFilters,
  openTasksQuery,
  type OpenTaskFilters,
} from "@/lib/validation/open-task-filters";

// На телефоне — по два списка в ряд, с sm — по ширине содержимого.
const SELECT_WRAPPER_CLASS = "min-w-0 basis-[calc(50%-4px)] sm:basis-auto";

/** Фильтры вкладки «Открытые» — GET-форма, как у архива: состояние в URL, без клиентского JS. */
export function OpenTasksFiltersForm({
  projectId,
  filters,
  categories,
  executors,
  queues,
}: {
  projectId: string;
  filters: OpenTaskFilters;
  categories: { id: string; name: string; is_archived: boolean }[];
  executors: { id: string; name: string; is_active: boolean }[];
  queues: { id: string; name: string }[];
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
        className="basis-full"
      />
      <NativeSelect
        name="category"
        aria-label="Цех"
        defaultValue={filters.category ?? ""}
        wrapperClassName={SELECT_WRAPPER_CLASS}
      >
        <option value="">Все цеха</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.is_archived ? `${c.name} (архив)` : c.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        name="executor"
        aria-label="Исполнитель"
        defaultValue={filters.executor ?? ""}
        wrapperClassName={SELECT_WRAPPER_CLASS}
      >
        <option value="">Все исполнители</option>
        {executors.map((e) => (
          <option key={e.id} value={e.id}>
            {e.is_active ? e.name : `${e.name} (неактивен)`}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        name="status"
        aria-label="Статус"
        defaultValue={filters.status ?? ""}
        wrapperClassName={SELECT_WRAPPER_CLASS}
      >
        <option value="">Все статусы</option>
        {OPEN_TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {taskStatusLabel(s)}
          </option>
        ))}
      </NativeSelect>
      {/* Как в форме создания: без своих очередей выбирать нечего. */}
      {queues.length > 0 ? (
        <NativeSelect
          name="queue"
          aria-label="Очередь"
          defaultValue={filters.queue ?? ""}
          wrapperClassName={SELECT_WRAPPER_CLASS}
        >
          <option value="">Все очереди</option>
          <option value={MAIN_QUEUE}>Текущие заявки</option>
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
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
