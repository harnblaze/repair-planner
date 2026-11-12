// Ограничение частоты действий в памяти процесса.
//
// Хранилище — обычный Map: приложение живёт в одном контейнере на Timeweb, а
// ради счётчика заводить Redis или таблицу в БД несоразмерно. Компромисс
// осознанный: если контейнеров станет несколько, лимит будет «на инстанс» —
// то есть при двух инстансах человек сможет отправить вдвое больше. Когда это
// станет важно, счётчик переедет в БД или в общий кэш; интерфейс функции от
// этого не изменится.
//
// Таймеров нет намеренно: в серверном процессе нельзя держать setInterval
// (он продлевает жизнь изолированного воркера и мешает выгрузке модуля), да и
// незачем — старые записи вычищаются при самих вызовах.

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Как часто убирать просроченные записи. Чистка на каждом вызове — лишний
// проход по Map при каждом сообщении; раз в 200 вызовов достаточно, чтобы
// словарь не рос бесконечно, но и не тормозил.
const CLEANUP_EVERY_CALLS = 200;
let callsSinceCleanup = 0;

function cleanup(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Списать одну единицу из лимита `key`.
 *
 * Окно фиксированное: первая единица открывает окно `windowMs`, по его
 * истечении счёт начинается заново. Такой вариант проще скользящего и для
 * защиты от флуда его достаточно.
 *
 * Возвращает `retryAfterMs` при отказе — по нему вызывающий пишет человеку,
 * сколько подождать.
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  callsSinceCleanup += 1;
  if (callsSinceCleanup >= CLEANUP_EVERY_CALLS) {
    callsSinceCleanup = 0;
    cleanup(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count < limit) {
    bucket.count += 1;
    return { ok: true };
  }

  return { ok: false, retryAfterMs: bucket.resetAt - now };
}

/** Сброс состояния. Нужен только тестам: в работе процесс живёт долго. */
export function resetRateLimits(): void {
  buckets.clear();
  callsSinceCleanup = 0;
}

/**
 * Сколько ключей сейчас в памяти. Только для тестов и диагностики: по этому
 * числу проверяется, что просроченные записи действительно вычищаются.
 */
export function rateLimitBucketCount(): number {
  return buckets.size;
}
