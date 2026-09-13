import { z } from "zod";

import { calendarDayKindFor, isValidDateString } from "@/lib/business/working-days";

// Вид исключения (нерабочий день / рабочая суббота) не вводится, а выводится
// из даты — calendarDayKindFor. Та же связь закреплена CHECK-ограничением
// в supabase/migrations/0013.

export const MIN_CALENDAR_YEAR = 2000;
export const MAX_CALENDAR_YEAR = 2100;

export const calendarDaySchema = z.object({
  day: z
    .string()
    .refine(isValidDateString, "Укажите дату")
    .refine(
      (day) => !isValidDateString(day) || calendarDayKindFor(day) !== null,
      "Воскресенье всегда выходной — отмечать его не нужно.",
    ),
  name: z.string().trim().max(120, "Название слишком длинное").optional(),
});

export type CalendarDayInput = z.infer<typeof calendarDaySchema>;

export const calendarYearSchema = z.number().int().min(MIN_CALENDAR_YEAR).max(MAX_CALENDAR_YEAR);
