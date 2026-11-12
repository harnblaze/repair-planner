import type { Metadata } from "next";

import { safeNextPath } from "@/lib/utils";

import { ConfirmFromHash } from "../confirm-from-hash";

export const metadata: Metadata = {
  title: "Подтверждение — Планировщик",
};

/**
 * Страница для ссылок, у которых токены пришли во фрагменте URL
 * (#access_token=…). Сервер фрагмент не видит, поэтому сюда уводит route
 * handler /auth/confirm, а сессию поднимает браузерный клиент Supabase.
 *
 * next проверяется заново: страницу можно открыть и напрямую, а уводить
 * человека на чужой сайт нельзя.
 */
export default async function ConfirmHashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw, "/profile");

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <ConfirmFromHash next={next} />
      </div>
    </main>
  );
}
