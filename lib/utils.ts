export { cn } from "cn"

const DEFAULT_AFTER_AUTH_PATH = "/projects"

/**
 * Путь для редиректа после входа или регистрации. Разрешён только путь внутри
 * приложения: "//host" и "/\host" браузер трактует как другой сайт.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_AFTER_AUTH_PATH,
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback
  }
  // Обратный слеш и управляющие символы браузер нормализует непредсказуемо.
  for (const char of next) {
    if (char === "\\" || char.charCodeAt(0) < 0x20) {
      return fallback
    }
  }
  return next
}

/**
 * Путь для редиректа из ссылки в письме (/auth/confirm). Supabase передаёт
 * адрес возврата полным URL ({{ .RedirectTo }}), поэтому URL того же хоста
 * приводится к пути; любой другой сайт — fallback. Сравнивается хост, а не
 * origin: за прокси с TLS запрос приходит по http, а ссылка — по https.
 * host — хост, к которому обратился браузер (x-forwarded-host / host), а не
 * request.url: Next строит его от хоста, на котором запущен сервер.
 */
export function confirmRedirectPath(next: string | null, host: string, fallback: string): string {
  if (next && /^https?:\/\//i.test(next)) {
    const url = URL.canParse(next) ? new URL(next) : null
    if (!url || url.host !== host) return fallback
    next = `${url.pathname}${url.search}${url.hash}`
  }
  return safeNextPath(next, fallback)
}
