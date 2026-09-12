import type { Metadata } from "next";
import Link from "next/link";

import { BookmarkIcon, CalendarIcon } from "@/components/common/icons";
import { formatDateLong, formatDateShort, todayInTimezone } from "@/lib/business/dates";
import { isCarriedOverOccurrence } from "@/lib/business/task-planning";
import {
  WEEKDAY_LABELS_RU,
  addWeeks,
  mondayOf,
  nextWorkingDay,
  weekWorkingDays,
} from "@/lib/business/working-days";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import type { BoardItem } from "./board-item-row";
import { BoardList } from "./board-list";
import { CreateTaskForm } from "./create-task-form";
import { Panel, PanelEmpty, PanelHeader } from "./panel";
import { TaskChip, TaskRow, type BoardTask } from "./task-chip";

export const metadata: Metadata = {
  title: "Доска — Repair Planner",
};

type ExecutorJoin = { executors: { name: string } | null };

function toExecutorNames(rows: ExecutorJoin[] | null | undefined): string[] {
  return (rows ?? []).map((r) => r.executors?.name).filter((name): name is string => Boolean(name));
}

// Сегментированная группа кнопок недели (docs/redesign.md §3): общая рамка у
// контейнера, разделители — между сегментами.
const WEEK_SEGMENT_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink active:bg-[#EBEFF5]";

export default async function BoardPage({
  params,
  searchParams,
}: PageProps<"/[projectId]/board">) {
  const { projectId } = await params;
  const { week } = await searchParams;

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("timezone")
    .eq("id", projectId)
    .single();

  const timezone = project?.timezone ?? "Europe/Moscow";
  const today = todayInTimezone(timezone);
  const currentMonday = mondayOf(today);
  const requestedWeek = typeof week === "string" ? week : undefined;
  const monday =
    requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)
      ? mondayOf(requestedWeek)
      : currentMonday;
  const weekDates = weekWorkingDays(monday);

  const [
    { data: backlogTasks },
    { data: scheduleRows },
    { data: categories },
    { data: boardLists },
    { data: boardItems },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, categories(name), task_executors(executors(name))")
      .eq("project_id", projectId)
      .is("planned_date", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_schedule")
      .select(
        "work_date, position, tasks(id, title, status, planned_date, categories(name), task_executors(executors(name)))",
      )
      .eq("project_id", projectId)
      .in("work_date", weekDates)
      .order("work_date", { ascending: true })
      .order("position", { ascending: true }),
    supabase
      .from("categories")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),
    supabase
      .from("board_lists")
      .select("id, name")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("board_items")
      .select("id, list_id, title, note, is_done, due_date")
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
  ]);

  const backlog: BoardTask[] = (backlogTasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    categoryName: t.categories?.name ?? null,
    executorNames: toExecutorNames(t.task_executors),
  }));

  const itemsByList = new Map<string, BoardItem[]>();
  for (const item of boardItems ?? []) {
    const list = itemsByList.get(item.list_id) ?? [];
    list.push(item);
    itemsByList.set(item.list_id, list);
  }

  const byDate = new Map<string, BoardTask[]>(weekDates.map((d) => [d, []]));
  for (const row of scheduleRows ?? []) {
    if (!row.tasks) continue;
    const list = byDate.get(row.work_date);
    if (!list) continue;
    const carriedOver = isCarriedOverOccurrence(row.work_date, row.tasks.planned_date);
    list.push({
      id: row.tasks.id,
      title: row.tasks.title,
      status: row.tasks.status,
      categoryName: row.tasks.categories?.name ?? null,
      executorNames: toExecutorNames(row.tasks.task_executors),
      // Дни расписания идут подряд по рабочим дням (перенос всегда добавляет
      // именно ближайший следующий рабочий день), поэтому следующий день этой
      // задачи вычисляется без дополнительного запроса.
      transferNote: carriedOver ? `Перенесена на ${formatDateLong(nextWorkingDay(row.work_date))}` : null,
    });
  }

  const isCurrentWeek = monday === currentMonday;

  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-[18px] pb-7">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
          <Link href={`/${projectId}/board?week=${addWeeks(monday, -1)}`} className={WEEK_SEGMENT_CLASS}>
            ← Пред. неделя
          </Link>
          {!isCurrentWeek ? (
            <Link href={`/${projectId}/board`} className={WEEK_SEGMENT_CLASS}>
              Сегодня
            </Link>
          ) : null}
          <Link href={`/${projectId}/board?week=${addWeeks(monday, 1)}`} className={WEEK_SEGMENT_CLASS}>
            След. неделя →
          </Link>
        </div>
        <div className="flex h-[30px] items-center gap-[7px] rounded-[7px] border border-control-line bg-surface px-[11px]">
          <CalendarIcon size={13} className="text-icon" />
          <span className="font-mono text-[12.5px] font-medium tracking-[-0.01em] text-ink">
            {formatDateShort(weekDates[0])} — {formatDateShort(weekDates[4])}
          </span>
        </div>
      </div>

      {/* Неделя — ряд из пяти колонок на всю ширину, без прокрутки и без переноса
          (docs/redesign.md §4). minmax(0,1fr) обязателен: иначе длинный заголовок
          задачи распирает колонку. */}
      <section className="overflow-hidden rounded-[10px] border border-line-strong bg-surface">
        <div className="grid grid-cols-[repeat(5,minmax(0,1fr))]">
          {weekDates.map((date, i) => {
            const tasks = byDate.get(date) ?? [];
            const isToday = date === today;

            return (
              <div
                key={date}
                className={cn(
                  "flex min-h-[216px] min-w-0 flex-col border-r border-line-subtle transition-colors duration-120",
                  isToday ? "bg-surface-today" : "bg-surface hover:bg-surface-column-hover",
                )}
              >
                <h2
                  className={cn(
                    "flex items-baseline gap-[7px] border-b border-line-subtle px-3.5 pt-[11px] pb-2.5",
                    isToday && "shadow-[inset_0_2px_0_0_var(--color-brand)]",
                  )}
                >
                  <span
                    className={cn(
                      "text-[13px] font-semibold",
                      isToday ? "text-brand" : "text-ink",
                    )}
                  >
                    {WEEKDAY_LABELS_RU[i]}
                  </span>
                  <span
                    className={cn("font-mono text-[12px]", isToday ? "text-brand" : "text-meta-dim")}
                  >
                    {formatDateShort(date)}
                  </span>
                  {tasks.length > 0 ? (
                    <span className="ml-auto font-mono text-[11px] font-medium text-counter">
                      {tasks.length}
                    </span>
                  ) : null}
                </h2>
                <div className="flex flex-col gap-[7px] p-2 xl:p-2.5">
                  {tasks.length === 0 ? (
                    <p className="px-0.5 py-1.5 text-[11.5px] text-faint">
                      Нет запланированных работ
                    </p>
                  ) : (
                    tasks.map((task) => (
                      <TaskChip key={task.id} projectId={projectId} task={task} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Дополнительные списки: «Текущие заявки» (задачи) и board_lists
          («Материалы к заказу», «Напоминания», «Мероприятия») — четыре панели
          в одном ряду под неделей. */}
      <section className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2.5 xl:gap-3.5">
        <Panel>
          <PanelHeader
            icon={<BookmarkIcon />}
            title="Текущие заявки"
            count={backlog.length}
          />
          <CreateTaskForm projectId={projectId} categories={categories ?? []} />
          {backlog.length === 0 ? (
            <PanelEmpty>Нет текущих заявок</PanelEmpty>
          ) : (
            <div className="flex flex-col p-1.5">
              {backlog.map((task) => (
                <TaskRow key={task.id} projectId={projectId} task={task} />
              ))}
            </div>
          )}
        </Panel>
        {(boardLists ?? []).map((list) => (
          <BoardList
            key={list.id}
            projectId={projectId}
            listId={list.id}
            name={list.name}
            items={itemsByList.get(list.id) ?? []}
            today={today}
          />
        ))}
      </section>
    </main>
  );
}
