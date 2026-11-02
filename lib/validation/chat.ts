import { z } from "zod";

// Зеркало CHECK из миграции 0033: body после trim — от 1 до 2000 символов.
// Проверяем на клиенте и повторно в экшене: клиенту верить нельзя.
export const CHAT_BODY_MAX = 2000;

export const chatMessageSchema = z.object({
  // id приходит от клиента: с ним оптимистичная вставка и событие Realtime
  // сходятся в одну строку (дедуп по id, lib/business/chat.ts:mergeMessages).
  id: z.guid(),
  body: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Сообщение не может быть пустым")
        .max(CHAT_BODY_MAX, "Слишком длинное сообщение"),
    ),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
