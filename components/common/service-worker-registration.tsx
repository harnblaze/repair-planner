"use client";

import { useEffect } from "react";

/**
 * Регистрирует public/sw.js (экран «Нет сети»). Только в production: в
 * next dev сервис-воркер мешал бы горячей перезагрузке и отладке.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.error("Service worker registration failed", error));
  }, []);
  return null;
}
