import webpush from "web-push";

import type { PushPayload } from "@/lib/business/push";
import { isPushEndpointAllowed } from "@/lib/validation/push";

// Отправка Web Push. Ключи VAPID — только в переменных окружения сервера:
// публичный уходит в браузер (NEXT_PUBLIC_*), приватный остаётся здесь.
// Без ключей функция считается ненастроенной, и интерфейс честно говорит,
// что уведомления выключены на сервере, вместо тихой ошибки в консоли.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

/** Настроены ли ключи — интерфейс спрашивает это до показа переключателя. */
export function isPushConfigured(): boolean {
  return PUBLIC_KEY.length > 0 && PRIVATE_KEY.length > 0;
}

let vapidReady = false;

function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    vapidReady = true;
  }
  return true;
}

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushResult = "sent" | "gone" | "failed";

/**
 * Отправить одно уведомление. «gone» — подписка мертва (устройство сбросилось,
 * разрешение отозвано, браузер переустановлен): такую строку надо удалить,
 * иначе она копится и тормозит рассылку.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  // Подписка могла быть сохранена до появления списка разрешённых хостов (или
  // подделана в обход формы). Отправка по такому адресу — запрос сервера на
  // чужой хост, поэтому строку просто не трогаем.
  if (!isPushEndpointAllowed(target.endpoint)) return "failed";

  if (!ensureVapid()) return "failed";

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      // Час: уведомление о сообщении, доставленное через сутки, бессмысленно.
      { TTL: 3_600 },
    );
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("push: отправка не удалась", status ?? error);
    return "failed";
  }
}
