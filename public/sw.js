// Сервис-воркер Планировщика. Единственная задача — показать экран
// «Нет соединения» вместо ошибки браузера, когда страница не загрузилась.
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
