import { z } from "zod";

import { isWorkingDay } from "@/lib/business/working-days";

// Входные данные перетаскивания на доске. Клиенту не доверяем: те же
// ограничения повторно проверяются в RPC (supabase/migrations/0008).

// z.guid, а не z.uuid: строгая проверка версии RFC 4122 не нужна — это просто идентификатор.
export const idSchema = z.guid();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workDateSchema = dateSchema.refine(isWorkingDay, {
  message: "Планировать можно только на рабочий день (Пн–Пт).",
});

const positionSchema = z.number().int().min(0).max(10_000);

export const planTaskOnDaySchema = z.object({
  taskId: idSchema,
  workDate: workDateSchema,
  position: positionSchema,
});

export const moveTaskScheduleSchema = z.object({
  taskId: idSchema,
  fromDate: dateSchema,
  toDate: workDateSchema,
  position: positionSchema,
});

export const moveBoardItemSchema = z.object({
  itemId: idSchema,
  position: positionSchema,
});

export type PlanTaskOnDayInput = z.infer<typeof planTaskOnDaySchema>;
export type MoveTaskScheduleInput = z.infer<typeof moveTaskScheduleSchema>;
export type MoveBoardItemInput = z.infer<typeof moveBoardItemSchema>;
