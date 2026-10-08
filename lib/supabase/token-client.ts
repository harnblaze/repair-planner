import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

// Только сервер: клиент на готовом access token, без cookies и без обновления
// сессии. Нужен для фоновой работы в after(): там клиент на cookies может
// обновить сессию, но не сохранить новые cookies, и браузер останется со
// старым, уже использованным refresh token. Истёкший токен даёт 401 — это
// безопаснее, чем потерянная сессия. RLS действует: Supabase проверяет токен.
export function createTokenClient(accessToken: string) {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => accessToken,
  });
}
