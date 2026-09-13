import type { Metadata } from "next";
import Link from "next/link";

import { CalendarIcon } from "@/components/common/icons";
import { formatDateShort, todayInTimezone } from "@/lib/business/dates";
import { describeOccurrence, lastWorkDate, type ScheduleDay } from "@/lib/business/task-planning";
import { canEditProject } from "@/lib/business/project-roles";
import {
  addWeeks,
  buildWorkCalendar,
  isWorkingDay,
  mondayOf,
  saturdayOf,
  weekBoardDays,
} from "@/lib/business/working-days";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";

import type { BoardItem } from "./board-item-row";
import { BoardList } from "./board-list";
import { WeekBoard, type BacklogTask, type DayTask } from "./week-board";

export const metadata: Metadata = {
  title: "Доска — Repair Planner",
};

type ExecutorJoin = { executors: { name: string } | null };

function toExecutorNames(rows: ExecutorJoin[] | null | undefined): string[] {
  return (rows ?? []).map((r) => r.executors?.name).filter((name): name is string => Boolean(name));
}

type ScheduleJoin = { work_date: string; postponed: boolean };

function toScheduleDays(rows: ScheduleJoin[] | null | undefined): ScheduleDay[] {
  return (rows ?? []).map((r) => ({ workDate: r.work_date, postponed: r.postponed }));
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
  const saturday = saturdayOf(monday);

  const [
    role,
    { data: calendarDays },
    { data: backlogTasks },
    { data: scheduleRows },
    { data: categories },
    { data: boardLists },
    { data: boardItems },
  ] = await Promise.all([
    getProjectRole(projectId),
    supabase
      .from("project_calendar_days")
      .select("day, kind, name")
      .eq("project_id", projectId)
      .gte("day", monday)
      .lte("day", saturday),
    supabase
      .from("tasks")
      // task_schedule — дни истории отложенной задачи: новый день не может быть раньше последнего.
      .select(
        "id, title, status, categories(name), task_executors(executors(name)), task_schedule(work_date, postponed)",
      )
      .eq("project_id", projectId)
      .is("planned_date", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_schedule")
      .select(
        "work_date, position, tasks(id, title, status, planned_date, categories(name), task_executors(executors(name)), task_schedule(work_date, postponed))",
      )
      .eq("project_id", projectId)
      // Пн–Сб: какие колонки показать, зависит от календаря и от задач на субботу.
      .gte("work_date", monday)
      .lte("work_date", saturday)
      .order("work_date", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
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
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const calendar = buildWorkCalendar(calendarDays ?? []);
  const weekDates = weekBoardDays(
    monday,
    calendar,
    (scheduleRows ?? []).some((row) => row.work_date === saturday),
  );
  // Нерабочие дни недели: дата → подпись под заголовком колонки. Суббота без
  // исключения попадает сюда, только если на неё остались задачи.
  const daysOff: Record<string, string> = Object.fromEntries(
    weekDates
      .filter((date) => !isWorkingDay(date, calendar))
      .map((date) => {
        const exception = calendar.get(date);
        return [date, exception ? (exception.name ?? "Нерабочий день") : "Выходной"];
      }),
  );

  const backlog: BacklogTask[] = (backlogTasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    categoryName: t.categories?.name ?? null,
    executorNames: toExecutorNames(t.task_executors),
    lastWorkDate: lastWorkDate(toScheduleDays(t.task_schedule)),
  }));

  const itemsByList = new Map<string, BoardItem[]>();
  for (const item of boardItems ?? []) {
    const list = itemsByList.get(item.list_id) ?? [];
    list.push(item);
    itemsByList.set(item.list_id, list);
  }

  const days: Record<string, DayTask[]> = Object.fromEntries(weekDates.map((d) => [d, []]));
  for (const row of scheduleRows ?? []) {
    if (!row.tasks) continue;
    const list = days[row.work_date];
    if (!list) continue;
    const occurrence = describeOccurrence(
      row.work_date,
      row.tasks.planned_date,
      toScheduleDays(row.tasks.task_schedule),
    );
    list.push({
      id: row.tasks.id,
      title: row.tasks.title,
      status: row.tasks.status,
      categoryName: row.tasks.categories?.name ?? null,
      executorNames: toExecutorNames(row.tasks.task_executors),
      isHistory: occurrence.isHistory,
      transferNote: occurrence.note,
      canChangeDay: occurrence.canChangeDay,
    });
  }

  const isCurrentWeek = monday === currentMonday;
  const canEdit = canEditProject(role);

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
            {formatDateShort(weekDates[0])} — {formatDateShort(weekDates[weekDates.length - 1])}
          </span>
        </div>
      </div>

      <WeekBoard
        projectId={projectId}
        today={today}
        weekDates={weekDates}
        daysOff={daysOff}
        days={days}
        backlog={backlog}
        categories={categories ?? []}
        canEdit={canEdit}
      >
        {(boardLists ?? []).map((list) => (
          <BoardList
            key={list.id}
            projectId={projectId}
            listId={list.id}
            name={list.name}
            items={itemsByList.get(list.id) ?? []}
            today={today}
            canEdit={canEdit}
          />
        ))}
      </WeekBoard>
    </main>
  );
}
