import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
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

import type { BoardItem } from "./board-item-row";
import { BoardList } from "./board-list";
import { CreateTaskForm } from "./create-task-form";
import { TaskChip, type BoardTask } from "./task-chip";

export const metadata: Metadata = {
  title: "Доска — Repair Planner",
};

type ExecutorJoin = { executors: { name: string } | null };

function toExecutorNames(rows: ExecutorJoin[] | null | undefined): string[] {
  return (rows ?? []).map((r) => r.executors?.name).filter((name): name is string => Boolean(name));
}

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
    <main className="flex flex-col gap-4 p-4 pt-8">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/${projectId}/board?week=${addWeeks(monday, -1)}`} />}
        >
          ← Пред. неделя
        </Button>
        {!isCurrentWeek ? (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={`/${projectId}/board`} />}
          >
            Сегодня
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/${projectId}/board?week=${addWeeks(monday, 1)}`} />}
        >
          След. неделя →
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatDateShort(weekDates[0])} – {formatDateShort(weekDates[4])}
        </span>
      </div>

      {/* Неделя — ряд колонок на всю ширину, а не горизонтальная прокрутка. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {weekDates.map((date, i) => (
          <div key={date} className="flex flex-col gap-1">
            <h2 className="flex items-baseline gap-1.5 border-b border-border pb-1.5">
              <span className="text-sm font-medium">{WEEKDAY_LABELS_RU[i]}</span>
              <span className="text-xs text-muted-foreground">{formatDateShort(date)}</span>
            </h2>
            <div className="flex flex-col">
              {(byDate.get(date) ?? []).length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">Пусто.</p>
              ) : (
                byDate.get(date)!.map((task) => (
                  <TaskChip key={task.id} projectId={projectId} task={task} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Дополнительные списки: «Текущие заявки» (задачи) и board_lists
          («Материалы к заказу», «Напоминания», «Мероприятия») — рядом друг
          с другом под неделей. */}
      <div className="mt-4 grid grid-cols-1 gap-6 border-t border-border pt-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Текущие заявки</h2>
          <CreateTaskForm projectId={projectId} categories={categories ?? []} />
          <div className="flex flex-col">
            {backlog.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">Пусто.</p>
            ) : (
              backlog.map((task) => <TaskChip key={task.id} projectId={projectId} task={task} />)
            )}
          </div>
        </div>
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
      </div>
    </main>
  );
}
