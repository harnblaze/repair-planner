import { z } from "zod";

import { isValidDateString } from "@/lib/business/working-days";

// Входные данные перетаскивания на доске. Клиенту не доверяем: те же
// ограничения повторно проверяются в RPC (supabase/migrations/0008, 0013).
// Рабочий ли день, здесь не проверяется: это зависит от календаря проекта,
// его проверяет RPC.

// z.guid, а не z.uuid: строгая проверка версии RFC 4122 не нужна — это просто идентификатор.
export const idSchema = z.guid();

const dateSchema = z.string().refine(isValidDateString);

const positionSchema = z.number().int().min(0).max(10_000);

export const planTaskOnDaySchema = z.object({
  taskId: idSchema,
  workDate: dateSchema,
  position: positionSchema,
});

export const moveTaskScheduleSchema = z.object({
  taskId: idSchema,
  fromDate: dateSchema,
  toDate: dateSchema,
  position: positionSchema,
});

export const moveBoardItemSchema = z.object({
  itemId: idSchema,
  position: positionSchema,
});

export const moveBoardListSchema = z.object({
  listId: idSchema,
  position: positionSchema,
});

export type PlanTaskOnDayInput = z.infer<typeof planTaskOnDaySchema>;
export type MoveTaskScheduleInput = z.infer<typeof moveTaskScheduleSchema>;
export type MoveBoardItemInput = z.infer<typeof moveBoardItemSchema>;
export type MoveBoardListInput = z.infer<typeof moveBoardListSchema>;
