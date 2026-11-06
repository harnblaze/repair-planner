// Значок с числом непрочитанных: на иконке приложения (Badging API) и на
// иконке вкладки браузера. Чистые функции — потому что и то, и другое легко
// проверить только глазами, а ошибиться в формате просто.

/** Больше этого числа на значке пишем «99+»: значок не резиновый. */
export const BADGE_LIMIT = 99;

/** Текст для значка: пусто — показывать нечего. */
export function badgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > BADGE_LIMIT ? `${BADGE_LIMIT}+` : String(count);
}

/** Заголовок вкладки с числом: «(3) Доска — Планировщик». */
export function titleWithBadge(title: string, count: number): string {
  const label = badgeLabel(count);
  const base = stripBadge(title);
  return label ? `(${label}) ${base}` : base;
}

/** Убрать прежний счётчик из заголовка — чтобы не накопилось «(1) (2)». */
export function stripBadge(title: string): string {
  return title.replace(/^\(\d+\+?\)\s*/, "").trim();
}

/**
 * Число для иконки вкладки: до 9 — цифра, дальше «9+».
 * На 16–32 пикселях две цифры ещё читаются, три — уже нет.
 */
export function faviconLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}
