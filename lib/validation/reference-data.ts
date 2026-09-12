import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Введите название").max(120, "Название слишком длинное"),
});

export type CategoryInput = z.infer<typeof categorySchema>;

export const executorSchema = z.object({
  name: z.string().trim().min(1, "Введите имя").max(120, "Имя слишком длинное"),
  position: z.string().trim().max(120, "Слишком длинно").optional(),
});

export type ExecutorInput = z.infer<typeof executorSchema>;

export const materialSchema = z.object({
  name: z.string().trim().min(1, "Введите название").max(120, "Название слишком длинное"),
  unit: z.string().trim().min(1, "Укажите единицу измерения").max(20, "Слишком длинно"),
  minimumBalance: z.coerce
    .number({ error: "Введите число" })
    .min(0, "Не может быть отрицательным"),
});

// z.coerce делает вход и выход схемы разными типами (строка из <input> → число).
// useForm нужно типизировать входным типом, а обработчик submit получает выходной.
export type MaterialInput = z.output<typeof materialSchema>;
export type MaterialFormValues = z.input<typeof materialSchema>;

// Только для создания: начальный остаток заносится как обычный приход
// (record_material_movement, kind = 'receipt'), а не прямой записью в
// current_balance — баланс должен оставаться выводимым из истории движений
// (docs/database.md §7.4). При редактировании материала этого поля нет —
// остаток меняется только через расход в задаче или будущий экран прихода.
export const createMaterialSchema = materialSchema.extend({
  initialQuantity: z.coerce
    .number({ error: "Введите число" })
    .min(0, "Не может быть отрицательным")
    .default(0),
});

export type CreateMaterialInput = z.output<typeof createMaterialSchema>;
export type CreateMaterialFormValues = z.input<typeof createMaterialSchema>;
