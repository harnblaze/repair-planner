import { z } from "zod";

// Лимит совпадает с CHECK task_queues.name (supabase/migrations/0018).
export const TASK_QUEUE_NAME_MAX = 60;

export const taskQueueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Введите название")
    .max(TASK_QUEUE_NAME_MAX, "Название слишком длинное"),
});

export type TaskQueueInput = z.infer<typeof taskQueueSchema>;
