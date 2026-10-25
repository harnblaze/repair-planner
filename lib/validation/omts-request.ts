import { z } from "zod";

// Заявка в ОМТС (docs/superpowers/plans/2026-10-25-omts-request-export.md).
// Пары типов, как в reference-data.ts: Input — выход схемы, FormValues — вход.

export const omtsHeaderSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Выберите месяц"),
  organization: z.string().trim().max(200, "Слишком длинно"),
  department: z.string().trim().min(1, "Укажите, от кого заявка").max(200, "Слишком длинно"),
  signerTitle: z.string().trim().max(100, "Слишком длинно"),
  signerName: z.string().trim().max(100, "Слишком длинно"),
});

export type OmtsHeaderInput = z.output<typeof omtsHeaderSchema>;
export type OmtsHeaderFormValues = z.input<typeof omtsHeaderSchema>;

export const omtsExportSchema = omtsHeaderSchema.extend({ listId: z.uuid() });

export type OmtsExportInput = z.output<typeof omtsExportSchema>;
