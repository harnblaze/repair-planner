import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Введите название заявки").max(300, "Слишком длинно"),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Введите название заявки").max(300, "Слишком длинно"),
  description: z.string().trim().max(5000, "Слишком длинно").optional(),
  categoryId: z.string().trim().optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
