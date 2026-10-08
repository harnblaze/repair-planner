import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { monthRange } from "@/lib/business/archive-periods";
import { ARCHIVE_QUERY_MAX, archiveQuery, type ArchiveFilters } from "@/lib/validation/archive-filters";

const LINK_CLASS = "text-[12.5px] text-meta transition-colors duration-120 hover:text-ink";

/** Фильтры архива — обычная GET-форма: состояние в URL, страница строится на сервере. */
export function ArchiveFiltersForm({
  projectId,
  filters,
  categories,
  executors,
  materials,
  today,
}: {
  projectId: string;
  filters: ArchiveFilters;
  categories: { id: string; name: string; is_archived: boolean }[];
  executors: { id: string; name: string; is_active: boolean }[];
  materials: { id: string; name: string; is_active: boolean }[];
  today: string;
}) {
  const base = `/${projectId}/tasks`;
  const hasPeriod = filters.from !== null || filters.to !== null;

  return (
    // key: после перехода по ссылке с другими фильтрами поля перемонтируются
    // и показывают значения нового URL, а не прежние.
    <form key={archiveQuery(filters)} method="get" action={base} role="search" className="flex flex-col gap-3">
      <input type="hidden" name="view" value="archive" />
      <Input
        type="search"
        name="q"
        defaultValue={filters.q}
        maxLength={ARCHIVE_QUERY_MAX}
        placeholder="Название или описание"
        aria-label="Поиск по названию или описанию"
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <NativeSelect name="status" aria-label="Статус" defaultValue={filters.status}>
          <option value="completed">Выполненные</option>
          <option value="cancelled">Отменённые</option>
          <option value="all">Все</option>
        </NativeSelect>
        <NativeSelect name="category" aria-label="Цех" defaultValue={filters.category ?? ""}>
          <option value="">Все цеха</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.is_archived ? `${c.name} (архив)` : c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="executor" aria-label="Исполнитель" defaultValue={filters.executor ?? ""}>
          <option value="">Все исполнители</option>
          {executors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.is_active ? e.name : `${e.name} (архив)`}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="material" aria-label="Материал" defaultValue={filters.material ?? ""}>
          <option value="">Все материалы</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.is_active ? m.name : `${m.name} (архив)`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
        <Label className="flex flex-col items-start gap-1 text-[12px] text-meta">
          Закрыта с
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Label>
        <Label className="flex flex-col items-start gap-1 text-[12px] text-meta">
          по
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={`${base}?${archiveQuery(filters, { ...monthRange(today, 0), page: 1 })}`} className={LINK_CLASS}>
          Этот месяц
        </Link>
        <Link href={`${base}?${archiveQuery(filters, { ...monthRange(today, -1), page: 1 })}`} className={LINK_CLASS}>
          Прошлый месяц
        </Link>
        {hasPeriod ? (
          <span className="text-[12px] text-meta-dim">Период — по дате выполнения или отмены</span>
        ) : null}
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit">Найти</Button>
        <Link href={`${base}?view=archive`} className={LINK_CLASS}>
          Сбросить
        </Link>
      </div>
    </form>
  );
}
