import { createBrowserClient } from "@supabase/ssr";

import { browserCookies } from "@/lib/supabase/browser-cookies";
import type { Database } from "@/lib/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Та же политика cookie, что у серверного клиента: Secure на проде, без
      // httpOnly (клиент читает cookie сам) и со сроком жизни из
      // lib/supabase/cookie-options.ts.
      cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
      // Своё хранилище: встроенное пишет cookie с maxAge 400 дней и не даёт
      // переопределить его через cookieOptions — см. комментарий в модуле.
      cookies: browserCookies,
    },
  );
}
