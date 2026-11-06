// Сервис-воркер Планировщика. Две задачи: экран «Нет соединения» вместо
// ошибки браузера и показ уведомлений о новых сообщениях в чате.
// Данные приложения намеренно НЕ кешируются: офлайн-режим вне MVP, а кеш
// показывал бы устаревшие остатки и оставлял данные проекта на устройстве.
// При изменении offline.html увеличить версию — старый кеш удалится.
const CACHE = "offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("offline-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Только переходы между страницами; запросы данных, скрипты и картинки
  // идут мимо сервис-воркера как обычно.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE });
      return offline ?? Response.error();
    }),
  );
});

// ── Уведомления ──────────────────────────────────────────────────────────────

// Приходит пуш от сервера: JSON собран в lib/business/push.ts.
// Уведомление обязано быть видимым (userVisibleOnly): если обработчик упадёт
// молча, браузер покажет своё «сайт обновился в фоне» — поэтому любая ошибка
// разбора заканчивается уведомлением с текстом по умолчанию.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Планировщик";
  const options = {
    body: payload.body || "Новое сообщение",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Метка схлопывания: оживлённая переписка не выстраивает стопку.
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Нажатие открывает нужный экран в уже открытой вкладке, иначе — новую.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        try {
          await client.navigate(target);
          return;
        } catch {
          // Safari не умеет navigate у клиента — открываем вкладку ниже.
          break;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
