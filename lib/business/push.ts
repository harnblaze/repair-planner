// Уведомления на телефон: что именно показывается в системном уведомлении.
// Логика здесь, а не в компоненте, чтобы её можно было проверить тестом:
// сервис-воркер и push-сервис не читают код приложения, они получают готовый
// JSON — и любая ошибка формата видна только на живом телефоне.

/** Сколько символов текста сообщения показывать в уведомлении. */
export const PUSH_BODY_LIMIT = 120;

export type PushPayload = {
  /** Заголовок: имя автора сообщения или название события. */
  title: string;
  /** Текст сообщения — одна строка, обрезанная по границе слова. */
  body: string;
  /** Куда ведёт нажатие. */
  url: string;
  /** Метка схлопывания: уведомления с одной меткой заменяют друг друга. */
  tag?: string;
};

/**
 * Текст сообщения для уведомления: переводы строк и повторные пробелы
 * схлопываются в один пробел (в уведомлении они всё равно не видны, а
 * многострочный текст в превью выглядит рвано), длинный текст обрезается
 * по границе слова — обрубок посреди слова читается как ошибка.
 */
export function pushBody(text: string, limit: number = PUSH_BODY_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "Новое сообщение";

  if (flat.length <= limit) return flat;

  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  const clipped = space > limit * 0.6 ? cut.slice(0, space) : cut;
  return `${clipped.trimEnd()}…`;
}

/** Что писать в уведомлении о сообщении в чате и куда вести по нажатию. */
export function chatPushPayload(input: {
  authorName: string;
  body: string;
  projectId: string;
  /** Сообщение без текста: одно фото или файл — так и пишем. */
  hasAttachments?: boolean;
}): PushPayload {
  const text = input.body.trim();
  return {
    title: input.authorName,
    body: text ? pushBody(text) : input.hasAttachments ? "Фото или файл" : "Новое сообщение",
    // Чат — виджет на любой странице проекта; ведём на доску, где он и стоит.
    url: `/${input.projectId}/board`,
    // Новые сообщения схлопываются в одно уведомление на проект, а не
    // выстраиваются стопкой при оживлённой переписке.
    tag: `chat:${input.projectId}`,
  };
}

/** Уведомление «проверить, что всё работает» из настроек профиля. */
export function testPushPayload(): PushPayload {
  return {
    title: "Планировщик",
    body: "Уведомления работают. Так будет выглядеть новое сообщение в чате.",
    url: "/profile",
    tag: "test",
  };
}

/**
 * Ключ VAPID приходит из переменной окружения в base64url, а PushManager ждёт
 * массив байт. `atob` понимает только обычный base64 — отсюда замена символов
 * и добивка паддингом.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = `${base64}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // Именно ArrayBuffer, а не длина: PushManager ждёт BufferSource с ArrayBuffer,
  // а Uint8Array поверх ArrayBufferLike TypeScript к нему не приводит.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/**
 * Версия iOS из user-agent. Нужна, чтобы честно сказать «нужна iOS 16.4+»,
 * а не «проверьте разрешения»: до 16.4 push в Safari не существует вовсе.
 */
export function iosVersion(userAgent: string): { major: number; minor: number } | null {
  const match = /(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/i.exec(userAgent);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Минимальная версия iOS с поддержкой Web Push (в установленном приложении). */
export const IOS_PUSH_MIN: { major: number; minor: number } = { major: 16, minor: 4 };

/** Поддерживает ли эта версия iOS push. Не-iOS не ограничиваем — решает браузер. */
export function iosSupportsPush(userAgent: string): boolean {
  const version = iosVersion(userAgent);
  if (!version) return true;
  if (version.major !== IOS_PUSH_MIN.major) return version.major > IOS_PUSH_MIN.major;
  return version.minor >= IOS_PUSH_MIN.minor;
}
