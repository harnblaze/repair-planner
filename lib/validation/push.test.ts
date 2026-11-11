import { describe, expect, it } from "vitest";

import { isPushEndpointAllowed, pushSubscriptionSchema } from "./push";

const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

/** Реальные адреса четырёх сервисов: именно такие приходят из браузеров. */
const VALID_ENDPOINTS = [
  "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH-abcdefghijklmnopqrstuvwxyz0123456789",
  "https://web.push.apple.com/QG3kL9Xy7z8aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABh-abcdefghijklmnopqrstuvwxyz",
  "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2babcdefghijklmnopqrstuvwxyz",
];

describe("isPushEndpointAllowed", () => {
  it("разрешает адреса push-сервисов всех четырёх семейств", () => {
    for (const endpoint of VALID_ENDPOINTS) {
      expect(isPushEndpointAllowed(endpoint)).toBe(true);
    }
  });

  it("разрешает поддомены сервисов", () => {
    expect(isPushEndpointAllowed("https://wns2-by3p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpointAllowed("https://eu.push.apple.com/QG3kL9Xy")).toBe(true);
    expect(isPushEndpointAllowed("https://updates.push.services.mozilla.com/wpush/v1/x")).toBe(true);
  });

  it("отклоняет http, чужие хосты и подделки под суффикс", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://evil.example/fcm/send/x",
      "https://fcm.googleapis.com.evil.example/fcm/send/x",
      "https://evilfcm.googleapis.com/fcm/send/x",
      "https://notify.windows.com.evil.example/w/?token=x",
      "https://evil-push.apple.com/QG3k",
      "https://push.apple.com.evil.example/QG3k",
      "ftp://fcm.googleapis.com/fcm/send/x",
      "не url",
      "",
    ]) {
      expect(isPushEndpointAllowed(endpoint)).toBe(false);
    }
  });
});

describe("pushSubscriptionSchema", () => {
  it("принимает подписку с адресом push-сервиса", () => {
    const parsed = pushSubscriptionSchema.parse({ ...KEYS, endpoint: VALID_ENDPOINTS[0] });
    expect(parsed.endpoint).toBe(VALID_ENDPOINTS[0]);
  });

  it("обрезает пробелы вокруг адреса и ключей", () => {
    const parsed = pushSubscriptionSchema.parse({
      endpoint: ` ${VALID_ENDPOINTS[1]} `,
      p256dh: ` ${KEYS.p256dh} `,
      auth: ` ${KEYS.auth} `,
    });
    expect(parsed).toEqual({ endpoint: VALID_ENDPOINTS[1], ...KEYS });
  });

  it("отклоняет чужой хост понятным сообщением без технических деталей", () => {
    const parsed = pushSubscriptionSchema.safeParse({ ...KEYS, endpoint: "https://internal.corp.local/push" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Это устройство не может принимать уведомления");
    }
  });

  it("отклоняет слишком длинный адрес тем же сообщением", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      ...KEYS,
      endpoint: `https://fcm.googleapis.com/${"a".repeat(2100)}`,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Это устройство не может принимать уведомления");
    }
  });

  it("требует ключи устройства", () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: VALID_ENDPOINTS[0], p256dh: "", auth: "" }).success).toBe(
      false,
    );
  });
});
