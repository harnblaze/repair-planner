import { z } from "zod";

export const boardItemSchema = z.object({
  title: z.string().trim().min(1, "Введите текст").max(300, "Слишком длинно"),
  note: z.string().trim().max(1000, "Слишком длинно").optional(),
  dueDate: z.string().trim().optional(),
});

export type BoardItemInput = z.infer<typeof boardItemSchema>;
