import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Введите название заявки").max(300, "Слишком длинно"),
  categoryId: z.string().trim().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// Поля карточки задачи сохраняются независимо друг от друга (по blur/change,
// без общей кнопки «Сохранить») — поэтому у каждого своя схема, а не одна общая.
export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, "Введите название заявки")
  .max(300, "Слишком длинно");

export const taskDescriptionSchema = z.string().trim().max(5000, "Слишком длинно");
