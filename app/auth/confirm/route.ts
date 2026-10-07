import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { confirmRedirectPath } from "@/lib/utils";

// Обработчик ссылок из писем Supabase Auth (восстановление пароля, подтверждение email).
// Шаблон письма настроен на token_hash/type, а не на implicit-флоу с фрагментом
// URL, потому что фрагмент не доходит до сервера — см. supabase/templates/recovery.html.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // request.url строится от хоста сервера, а не от адреса, по которому пришёл браузер.
  // За цепочкой прокси x-forwarded-host — список через запятую, первый — адрес браузера.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // next приходит из ссылки — только путь этого же сайта, иначе open redirect.
  const next = confirmRedirectPath(searchParams.get("next"), host, "/profile");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      redirect(next);
    }
  }

  redirect("/forgot-password?expired=1");
}
