import { z } from "zod";

// Подписка устройства. Ключи (p256dh, auth) приходят от браузера и по формату
// — base64url; проверяем только наличие и разумную длину: строгий разбор
// сломался бы на первом же обновлении формата в браузере.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000).pipe(z.url()),
  p256dh: z.string().trim().min(1).max(255),
  auth: z.string().trim().min(1).max(255),
  userAgent: z.string().trim().max(400).optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
