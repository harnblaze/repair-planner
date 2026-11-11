import { z } from "zod";

// Подписка устройства. Ключи (p256dh, auth) приходят от браузера и по формату
// — base64url; проверяем только наличие и разумную длину: строгий разбор
// сломался бы на первом же обновлении формата в браузере.

/**
 * Хосты push-сервисов, которым сервер имеет право отправлять запрос.
 *
 * Endpoint приходит из браузера и сохраняется в БД, а отправка — это POST,
 * который делает наш сервер. Без списка любой вошедший пользователь мог бы
 * указать адрес внутреннего https-сервиса и заставить сервер сходить туда
 * (слепая SSRF). Настоящие адреса есть только у этих четырёх сервисов.
 */
const PUSH_HOSTS = new Set([
  // Chrome, Edge и Firefox на Android — FCM.
  "fcm.googleapis.com",
  // Safari: адрес вида web.push.apple.com.
  "web.push.apple.com",
  // Firefox на десктопе.
  "updates.push.services.mozilla.com",
]);

/** Поддомены сервисов: `*.push.apple.com`, `wns2-…notify.windows.com` и т. п. */
const PUSH_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

/**
 * Разрешён ли адрес подписки. Только https и только хост из списка: сравнение
 * с точкой в суффиксе не пропускает `fcm.googleapis.com.attacker.tld` и
 * `evilfcm.googleapis.com`.
 */
export function isPushEndpointAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// Текст отказа один на все случаи: пользователю незачем знать, чем именно не
// устроил адрес устройства.
const ENDPOINT_MESSAGE = "Это устройство не может принимать уведомления";

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .max(2000, ENDPOINT_MESSAGE)
    .refine(isPushEndpointAllowed, ENDPOINT_MESSAGE),
  p256dh: z.string().trim().min(1).max(255),
  auth: z.string().trim().min(1).max(255),
  userAgent: z.string().trim().max(400).optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
