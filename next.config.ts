import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Timeweb Apps собирает Next.js в Docker и удаляет node_modules из
  // финального образа, ожидая самодостаточный сервер из .next/standalone.
  // Без этой опции next build не создаёт standalone-бандл, и контейнеру
  // нечем запускаться.
  output: "standalone",
};

export default nextConfig;
