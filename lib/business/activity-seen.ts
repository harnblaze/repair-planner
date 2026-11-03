// Отметка «ленту читали до этого момента» — в localStorage, по проекту.
//
// Хранится ISO-время, а не число записей: записи в ленте удаляются и добавляются
// задним числом, а время — устойчивый якорь. Плюс метка не растёт от того, что
// человек зашёл в ленту ещё раз.

/** Глубже этого срока «новое» не считаем: старая история не должна светиться вечно. */
export const ACTIVITY_SEEN_WINDOW_DAYS = 30;

/** Ключ хранилища для проекта: у каждого проекта своя метка. */
export function activitySeenKey(projectId: string): string {
  return `activity:seen:${projectId}`;
}

/**
 * Значение из localStorage: валидное ISO-время или null.
 *
 * Возвращаем строку как есть, а не пересобранную через Date: в Postgres время
 * хранится с микросекундами, а `Date` режет до миллисекунд, и метка оказывалась
 * бы «раньше» только что прочитанной записи — бейдж снова показывал бы её же.
 * Единственная правка — `+00:00` → `Z`: плюс в значении фильтра PostgREST
 * пришлось бы экранировать, а Z — тот же момент времени.
 */
export function parseSeenAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return value.replace(/\+00:00$/, "Z");
}

/** Есть ли записи новее метки. `since = null` — метки нет, значит новое всё. */
export function isNewer(iso: string, since: string | null): boolean {
  if (!since) return true;
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return false;
  return value > Date.parse(since);
}

/**
 * Нижняя граница подсчёта: не глубже окна и не старше метки.
 * Возвращает ISO-строку для запроса «created_at > ...».
 */
export function countSince(seenAt: string | null, now: Date): string {
  const windowStart = new Date(now.getTime() - ACTIVITY_SEEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!seenAt) return windowStart.toISOString();
  const seen = Date.parse(seenAt);
  if (Number.isNaN(seen) || seen < windowStart.getTime()) return windowStart.toISOString();
  return seenAt;
}
