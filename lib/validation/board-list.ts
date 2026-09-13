import { z } from "zod";

// Лимит совпадает с CHECK board_lists_name_check (supabase/migrations/0014).
export const BOARD_LIST_NAME_MAX = 80;

export const boardListSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Введите название")
    .max(BOARD_LIST_NAME_MAX, "Название слишком длинное"),
});

export type BoardListInput = z.infer<typeof boardListSchema>;
