import type { MetadataRoute } from "next";

// Манифест для установки на главный экран (PWA). Иконки — public/icons/,
// генерируются scripts/generate-pwa-icons.mjs. Цвета — из app/globals.css:
// фон страницы (--color-page) и белая шапка (--color-surface).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Планировщик",
    short_name: "Планировщик",
    description: "Планирование и управление работами ремонтно-строительного цеха",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ru",
    background_color: "#f1f3f6",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
