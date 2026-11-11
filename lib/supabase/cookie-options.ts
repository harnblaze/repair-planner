import type { CookieOptions } from "@supabase/ssr";

/**
 * Срок жизни cookie сессии Supabase.
 *
 * `@supabase/ssr` в обоих своих `setAll` жёстко ставит `maxAge` из
 * DEFAULT_COOKIE_OPTIONS (400 дней) и игнорирует `cookieOptions.maxAge` —
 * поэтому сокращать срок приходится уже в наших `setAll`. 400 дней на общем
 * планшете в цеху означают чужой вход: приложение должно само разлогиниться
 * через месяц, даже если о нём забыли.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Переписать срок жизни cookie, сохранив остальные опции (secure, sameSite,
 * path, domain). `maxAge: 0` — это удаление cookie при выходе: оно обязано
 * остаться немедленным, иначе выход не сработает до истечения нового срока.
 */
export function withSessionMaxAge(options: CookieOptions): CookieOptions {
  if (options.maxAge === 0) return options;
  return { ...options, maxAge: SESSION_MAX_AGE_SECONDS };
}
