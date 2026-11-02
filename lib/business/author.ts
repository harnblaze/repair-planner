// Подпись автора заявки и пункта списка. В мета-строке узкой колонки нужно
// короткое имя — «Иванов И. И.»: фамилия и инициалы. Полное ФИО уходит в
// подсказку (title), поэтому здесь важна краткость, а не полнота.

/** Что показываем, когда профиль есть, а имени в нём нет. */
export const UNKNOWN_AUTHOR = "Без имени";

/**
 * «Иванов Иван Иванович» → «Иванов И. И.»; одно слово — как есть (в профиле
 * бывает просто «Сергей»); пусто или null — «Без имени».
 * Двойная фамилия через дефис остаётся одним словом: «Иванов-Петров И.».
 */
export function formatAuthorName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return UNKNOWN_AUTHOR;
  if (parts.length === 1) return parts[0];

  const [surname, ...rest] = parts;
  return `${surname} ${rest.map((part) => `${part[0]}.`).join(" ")}`;
}

/** Строка project_member_list: имя нужно только для подписи, остальное лишнее. */
export type AuthorRow = { user_id: string; full_name: string | null };

/**
 * Справочник user_id → полное имя на одну страницу: имена берутся одним
 * запросом, а не по запросу на строку доски или списка.
 */
export function toAuthorMap(rows: AuthorRow[] | null | undefined): Map<string, string | null> {
  return new Map((rows ?? []).map((row) => [row.user_id, row.full_name]));
}

/** Подпись автора по id: нет id — нет подписи (старая строка или импорт). */
export function authorLabel(
  names: Map<string, string | null>,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  // Автор мог выйти из проекта — тогда имени в справочнике уже нет.
  return formatAuthorName(names.get(userId) ?? null);
}

/** Полное ФИО для подсказки; null — подсказку не показываем. */
export function authorFullName(
  names: Map<string, string | null>,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return names.get(userId)?.trim() || null;
}
