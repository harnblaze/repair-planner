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

export const taskMaterialSchema = z.object({
  materialId: z.string().trim().min(1, "Выберите материал"),
  quantity: z.coerce
    .number({ error: "Введите число" })
    .positive("Количество должно быть больше нуля")
    .max(99999999999, "Слишком большое количество"),
  note: z.string().trim().max(300, "Слишком длинно").optional(),
});

// z.coerce делает вход и выход схемы разными типами (строка из <input> → число).
export type TaskMaterialInput = z.output<typeof taskMaterialSchema>;
export type TaskMaterialFormValues = z.input<typeof taskMaterialSchema>;
