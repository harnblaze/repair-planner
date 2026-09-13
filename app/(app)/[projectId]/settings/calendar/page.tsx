import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayInTimezone } from "@/lib/business/dates";
import { canEditProject } from "@/lib/business/project-roles";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from "@/lib/validation/calendar";

import { AddCalendarDayForm } from "./add-calendar-day-form";
import { AddPublicHolidaysButton } from "./add-public-holidays-button";
import { CalendarDayRow } from "./calendar-day-row";

export const metadata: Metadata = {
  title: "Производственный календарь — Repair Planner",
};

// Сегментированная группа кнопок года — как навигация по неделям на доске.
const YEAR_SEGMENT_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink active:bg-[#EBEFF5]";

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: PageProps<"/[projectId]/settings/calendar">) {
  const { projectId } = await params;
  const { year: yearParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: project }, role] = await Promise.all([
    supabase.from("projects").select("timezone").eq("id", projectId).single(),
    getProjectRole(projectId),
  ]);

  const currentYear = Number(todayInTimezone(project?.timezone ?? "Europe/Moscow").slice(0, 4));
  const requestedYear = typeof yearParam === "string" ? Number(yearParam) : NaN;
  const year =
    Number.isInteger(requestedYear) && requestedYear >= MIN_CALENDAR_YEAR && requestedYear <= MAX_CALENDAR_YEAR
      ? requestedYear
      : currentYear;

  const { data: calendarDays, error } = await supabase
    .from("project_calendar_days")
    .select("id, day, kind, name")
    .eq("project_id", projectId)
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day", { ascending: true });

  if (error) console.error("ProjectCalendarPage:", error);

  const canEdit = canEditProject(role);
  const base = `/${projectId}/settings/calendar`;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-6 pb-7">
      <Link href={`/${projectId}/settings`} className="self-start text-[12.5px] text-meta hover:text-ink">
        ← Настройки проекта
      </Link>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Производственный календарь</CardTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
              {year > MIN_CALENDAR_YEAR ? (
                <Link href={`${base}?year=${year - 1}`} className={YEAR_SEGMENT_CLASS}>
                  ← {year - 1}
                </Link>
              ) : null}
              {year !== currentYear ? (
                <Link href={base} className={YEAR_SEGMENT_CLASS}>
                  Текущий
                </Link>
              ) : null}
              {year < MAX_CALENDAR_YEAR ? (
                <Link href={`${base}?year=${year + 1}`} className={YEAR_SEGMENT_CLASS}>
                  {year + 1} →
                </Link>
              ) : null}
            </div>
            <span className="text-[13px] font-semibold text-ink">{year} год</span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12.5px] text-ink-muted">
            Пн–Пт — рабочие дни, суббота и воскресенье — выходные. Здесь отмечаются исключения:
            праздники и перенесённые выходные в будни, рабочие субботы. Нерабочие дни видны на доске,
            планировать и переносить на них заявки нельзя.
          </p>

          {canEdit ? (
            <>
              <AddCalendarDayForm projectId={projectId} />
              <AddPublicHolidaysButton projectId={projectId} year={year} />
            </>
          ) : null}

          <div className="flex flex-col divide-y divide-line-subtle">
            {error ? (
              <EmptyState>Не удалось загрузить календарь. Обновите страницу.</EmptyState>
            ) : (calendarDays ?? []).length === 0 ? (
              <EmptyState>В {year} году исключений нет.</EmptyState>
            ) : (
              (calendarDays ?? []).map((calendarDay) => (
                <CalendarDayRow
                  key={calendarDay.id}
                  projectId={projectId}
                  calendarDay={calendarDay}
                  canEdit={canEdit}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
