import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Timeweb Apps собирает Next.js в Docker и удаляет node_modules из
  // финального образа, ожидая самодостаточный сервер из .next/standalone.
  // Без этой опции next build не создаёт standalone-бандл, и контейнеру
  // нечем запускаться.
  output: "standalone",
  // Только для next dev: локальный Supabase строит ссылки из писем от
  // site_url = http://127.0.0.1:3000 (supabase/config.toml), а dev-ресурсы
  // (_next, HMR) по умолчанию отдаются только для localhost — без этого
  // страницы по ссылкам из писем не гидратируются.
  allowedDevOrigins: ["127.0.0.1"],
  // next dev по умолчанию печатает каждый вызов Server Function с аргументами —
  // для loginAction/registerAction это email и пароль в терминале и логах.
  logging: {
    serverFunctions: false,
  },
  // Стек и версию фреймворка незачем показывать в каждом ответе: это
  // бесплатная подсказка для подбора CVE.
  poweredByHeader: false,
  // Сервис-воркер нельзя кешировать: иначе браузер не увидит обновление
  // public/sw.js (новую версию экрана «Нет сети») после деплоя.
  async headers() {
    return [
      {
        // Заголовки безопасности на все ответы. HSTS намеренно без
        // includeSubDomains: служебные поддомены (www и старый адрес) пока
        // живут по http, и includeSubDomains молча сломал бы их для браузеров,
        // где http уже открывали.
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // clipboard-write/clipboard-read не перечисляем: в приложении есть
          // копирование в буфер, и пустой allowlist его сломает.
          {
            key: "Permissions-Policy",
            value: "geolocation=(), camera=(), microphone=(), usb=(), payment=()",
          },
          // ОСОЗНАННО частичный CSP — только директивы, которым не нужен nonce.
          // script-src/style-src сюда добавлять нельзя: в app/layout.tsx есть
          // инлайновый скрипт темы, Next инлайнит RSC-пейлоад, а страницы
          // отдаются пререндером (x-nextjs-prerender: 1, s-maxage=31536000) —
          // с nonce всех посетителей угощали бы одним значением из кэша.
          // Полный CSP — отдельный этап с динамическим рендером.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
