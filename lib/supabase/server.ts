import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { withSessionMaxAge } from "@/lib/supabase/cookie-options";
import type { Database } from "@/lib/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Secure на проде: без него браузер отправит cookie и по http до
      // редиректа на https. httpOnly включать нельзя — тот же токен читает
      // браузерный клиент через document.cookie, и сессия в браузере отвалится.
      cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, withSessionMaxAge(options));
            }
          } catch {
            // Вызвано из Server Component без возможности записи cookie.
            // Сессия в этом случае обновляется в proxy.ts.
          }
        },
      },
    },
  );
}
