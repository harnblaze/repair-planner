import { beforeEach, describe, expect, it, vi } from "vitest";

// Отправка проверяется с подменённым web-push: настоящий требует живой
// push-сервис и валидную подписку устройства. Наш код — это разбор ответа:
// «ушло», «подписка мертва» или «ошибка», и от него зависит, чистим ли строку.

const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

// Адрес — из разрешённых хостов (lib/validation/push.ts): по чужому отправка
// не делается вовсе, это проверяется отдельным тестом ниже.
const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH-test",
  p256dh: "key",
  auth: "secret",
};
const payload = { title: "Дмитрий", body: "Проверь заявку", url: "/p-1/board", tag: "chat:p-1" };

async function importSend() {
  vi.resetModules();
  return import("./send");
}

describe("sendPush", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    sendNotification.mockReset();
  });

  it("без ключей на сервере ничего не отправляет", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const { sendPush, isPushConfigured } = await importSend();
    expect(isPushConfigured()).toBe(false);
    expect(await sendPush(target, payload)).toBe("failed");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("успешная отправка отдаёт текст сообщения как есть", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const { sendPush, isPushConfigured } = await importSend();
    expect(isPushConfigured()).toBe(true);
    expect(await sendPush(target, payload)).toBe("sent");

    const [subscription, body, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: target.endpoint, keys: { p256dh: "key", auth: "secret" } });
    expect(JSON.parse(body)).toEqual(payload);
    expect(options.TTL).toBeGreaterThan(0);
  });

  it("410 и 404 — подписка мертва, её надо удалить", async () => {
    const { sendPush } = await importSend();

    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    expect(await sendPush(target, payload)).toBe("gone");

    sendNotification.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    expect(await sendPush(target, payload)).toBe("gone");
  });

  it("прочие ошибки — «failed», строку не трогаем", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("server"), { statusCode: 500 }));
    const { sendPush } = await importSend();
    expect(await sendPush(target, payload)).toBe("failed");
  });

  it("по чужому адресу не отправляет: подписка могла остаться с прежних времён", async () => {
    const { sendPush } = await importSend();
    expect(await sendPush({ ...target, endpoint: "https://internal.corp.local/push" }, payload)).toBe("failed");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
