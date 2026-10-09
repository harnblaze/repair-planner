import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { ServiceWorkerRegistration } from "@/components/common/service-worker-registration";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Repair Planner",
  description: "Планирование и управление работами ремонтно-строительного цеха",
  // Установка на главный экран iPhone: Safari не читает иконки из манифеста.
  appleWebApp: { title: "Планировщик", capable: true, statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Цвет строки состояния и заголовка окна установленного приложения — как у шапки.
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="bottom-center" />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
