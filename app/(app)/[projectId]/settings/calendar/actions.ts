"use server";

import { revalidatePath } from "next/cache";

import { formatDateLong } from "@/lib/business/dates";
import { russianPublicHolidays } from "@/lib/business/public-holidays";
import { calendarDayKindFor } from "@/lib/business/working-days";
import { isUniqueViolation } from "@/lib/errors";
import { requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { idSchema } from "@/lib/validation/board-move";
import {
  calendarDaySchema,
  calendarYearSchema,
  type CalendarDayInput,
} from "@/lib/validation/calendar";

// Календарь влияет на доску, перенос и подпись кнопки переноса в карточках
// заявок — обновляется всё дерево проекта.
function revalidateCalendar(projectId: string) {
  revalidatePath(`/${projectId}`, "layout");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Сколько заявок стоит в расписании на дату — для предупреждения, что они останутся на месте. */
async function countScheduledTasks(supabase: Supabase, projectId: string, day: string) {
  const { count } = await supabase
    .from("task_schedule")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("work_date", day);
  return count ?? 0;
}

export async function addCalendarDayAction(
  projectId: string,
  input: CalendarDayInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = calendarDaySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { day, name } = parsed.data;
  // Схема уже отклонила воскресенье, kind здесь всегда определён.
  const kind = calendarDayKindFor(day)!;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { error } = await supabase.from("project_calendar_days").insert({
    project_id: projectId,
    day,
    kind,
    name: name || null,
    created_by: user.id,
  });

  if (error) {
    console.error("addCalendarDayAction:", error);
    if (isUniqueViolation(error)) {
      return { ok: false, error: `${formatDateLong(day)} уже есть в календаре.` };
    }
    return { ok: false, error: "Не удалось добавить день. Попробуйте ещё раз." };
  }

  revalidateCalendar(projectId);

  if (kind === "holiday") {
    const scheduled = await countScheduledTasks(supabase, projectId, day);
    if (scheduled > 0) {
      return {
        ok: true,
        message: `${formatDateLong(day)} отмечен нерабочим. Запланированные на этот день заявки (${scheduled}) остались на месте — перенесите их при необходимости.`,
      };
    }
    return { ok: true, message: `${formatDateLong(day)} отмечен нерабочим.` };
  }
  return { ok: true, message: `${formatDateLong(day)} отмечена рабочей субботой.` };
}

export async function deleteCalendarDayAction(
  projectId: string,
  calendarDayId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!idSchema.safeParse(calendarDayId).success) {
    return { ok: false, error: "День не найден. Обновите страницу." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_calendar_days")
    .delete()
    .eq("id", calendarDayId)
    .eq("project_id", projectId)
    .select("day, kind");

  if (error) {
    console.error("deleteCalendarDayAction:", error);
    return { ok: false, error: "Не удалось удалить день. Попробуйте ещё раз." };
  }
  const deleted = data?.[0];
  if (!deleted) {
    return { ok: false, error: "День не найден. Обновите страницу." };
  }

  revalidateCalendar(projectId);

  if (deleted.kind === "working_day") {
    const scheduled = await countScheduledTasks(supabase, projectId, deleted.day);
    if (scheduled > 0) {
      return {
        ok: true,
        message: `Суббота снова выходная. Запланированные на неё заявки (${scheduled}) остались на доске — перенесите их при необходимости.`,
      };
    }
  }
  return { ok: true, message: "День удалён из календаря." };
}

export async function addPublicHolidaysAction(projectId: string, year: number): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!calendarYearSchema.safeParse(year).success) {
    return { ok: false, error: "Некорректный год." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла. Войдите снова." };
  }

  const { holidays, onWeekendCount } = russianPublicHolidays(year);

  // Уже отмеченные даты не перезаписываются: мастер мог дать им своё название.
  const { data, error } = await supabase
    .from("project_calendar_days")
    .upsert(
      holidays.map((h) => ({
        project_id: projectId,
        day: h.day,
        kind: h.kind,
        name: h.name,
        created_by: user.id,
      })),
      { onConflict: "project_id,day", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    console.error("addPublicHolidaysAction:", error);
    return { ok: false, error: "Не удалось добавить праздники. Попробуйте ещё раз." };
  }

  revalidateCalendar(projectId);

  const added = data?.length ?? 0;
  const weekendNote =
    onWeekendCount > 0
      ? ` Праздники, выпавшие на выходные (${onWeekendCount}), не добавлены — переносы выходных по постановлению Правительства отметьте вручную.`
      : " Переносы выходных по постановлению Правительства отметьте вручную.";

  if (added === 0) {
    return { ok: true, message: `Все государственные праздники ${year} года уже в календаре.` };
  }
  return { ok: true, message: `Добавлено праздничных дней: ${added}.${weekendNote}` };
}
