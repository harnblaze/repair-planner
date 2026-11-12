import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { confirmBranch, unwrapConfirmNext } from "@/lib/business/confirm";
import { createClient } from "@/lib/supabase/server";
import { confirmRedirectPath, safeNextPath } from "@/lib/utils";

const EXPIRED = "/forgot-password?expired=1";

/**
 * Ссылки из писем Supabase Auth: подтверждение email и восстановление пароля.
 *
 * Почему route handler, а не страница: здесь нужно записать cookie сессии, а в
 * серверном компоненте `cookies().set()` бросает исключение. Наш клиент это
 * исключение глотает (чтобы страницы не падали), и сессия потерялась бы —
 * человек попал бы на форму нового пароля, но без права его сменить.
 *
 * Веток три (см. lib/business/confirm.ts): token_hash из наших шаблонов,
 * PKCE-код из шаблона Supabase по умолчанию и токены во фрагменте URL. Для
 * фрагмента сервер бессилен — фрагмент до него не доходит, поэтому уводим на
 * страницу, которая дождётся сессии в браузере.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // request.url строится от хоста сервера, а не от адреса, по которому пришёл
  // браузер; за цепочкой прокси x-forwarded-host — список через запятую.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",")[0]
    .trim();

  // next приходит из ссылки — только путь этого же сайта, иначе open redirect.
  const next = unwrapConfirmNext(confirmRedirectPath(params.get("next"), host, "/profile"), (value) =>
    safeNextPath(value, "/profile"),
  );

  const branch = confirmBranch({
    error: params.get("error"),
    errorDescription: params.get("error_description"),
    tokenHash: params.get("token_hash"),
    type: params.get("type"),
    code: params.get("code"),
  });

  if (branch === "expired") redirect(EXPIRED);

  if (branch === "otp") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: params.get("type") as EmailOtpType,
      token_hash: params.get("token_hash") ?? "",
    });

    if (error) redirect(EXPIRED);
    redirect(next);
  }

  if (branch === "code") {
    const supabase = await createClient();
    // Неверный или просроченный код GoTrue кидает исключением, а не отдаёт
    // error в ответе; redirect внутри try нельзя — он сам кидает NEXT_REDIRECT.
    let failed = false;
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(params.get("code") ?? "");
      failed = Boolean(error);
    } catch {
      failed = true;
    }

    if (failed) redirect(EXPIRED);
    redirect(next);
  }

  // Токены во фрагменте: сервер их не видит — страница поднимет сессию браузером.
  redirect(`/auth/confirm/hash?next=${encodeURIComponent(next)}`);
}
