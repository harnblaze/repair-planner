export { cn } from "cn"

const DEFAULT_AFTER_AUTH_PATH = "/projects"

/**
 * Путь для редиректа после входа или регистрации. Разрешён только путь внутри
 * приложения: "//host" и "/\host" браузер трактует как другой сайт.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return DEFAULT_AFTER_AUTH_PATH
  }
  // Обратный слеш и управляющие символы браузер нормализует непредсказуемо.
  for (const char of next) {
    if (char === "\\" || char.charCodeAt(0) < 0x20) {
      return DEFAULT_AFTER_AUTH_PATH
    }
  }
  return next
}
