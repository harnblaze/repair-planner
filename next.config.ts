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
};

export default nextConfig;
