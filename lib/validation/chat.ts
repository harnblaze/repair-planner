import { z } from "zod";

import { REACTION_EMOJI } from "@/lib/business/chat";

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

/**
 * Правка сообщения: тело проверяется теми же правилами, что и при отправке
 * (пустое или длиннее 2000 — нельзя), только вместо нового id приходит id
 * существующего сообщения.
 */
export const chatEditSchema = z.object({
  messageId: z.guid(),
  body: chatMessageSchema.shape.body,
});

export type ChatEditInput = z.infer<typeof chatEditSchema>;

/**
 * Набор реакций живёт в lib/business/chat.ts: там он нужен виджету, а этот файл
 * тянет zod — импортировать его в клиентский компонент незачем. Здесь только
 * ре-экспорт, чтобы у набора было одно определение.
 */
export { REACTION_EMOJI, type ReactionEmoji } from "@/lib/business/chat";

export const reactionSchema = z.object({
  messageId: z.guid(),
  // z.enum принимает кортеж строк — набор фиксированный, произвольные эмодзи нельзя.
  emoji: z.enum(REACTION_EMOJI),
});

export type ReactionInput = z.infer<typeof reactionSchema>;
