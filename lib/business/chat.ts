import { formatDateShort, todayInTimezone } from "./dates";

// Логика чата без DOM: всё, что можно проверить тестом, живёт здесь, а не в
// компоненте. jsdom и testing-library в проекте нет, поэтому компонент
// тестами не покрыть — значит из него надо вынести как можно больше.

/** Строка чата в том виде, в каком её отдаёт БД и принимает Realtime. */
export type ChatMessage = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export const CHAT_BODY_MAX = 2000;

/** Сколько последних сообщений отдаём при открытии и дозапросе. */
export const CHAT_PAGE_SIZE = 50;

/** Текст к отправке: без крайних пробелов, как и CHECK в БД. */
export function normalizeBody(body: string): string {
  return body.trim();
}

/** Те же правила, что CHECK в 0033: 1..2000 после trim. */
export function canSend(body: string): boolean {
  const text = normalizeBody(body);
  return text.length >= 1 && text.length <= CHAT_BODY_MAX;
}

/**
 * Склейка ленты: дедуп по id и порядок по времени.
 *
 * Одно и то же сообщение приходит дважды — оптимистичной вставкой и событием
 * Realtime (или догоняющим запросом после реконнекта). Ключ у них общий, потому
 * что id генерирует клиент; здесь побеждает пришедшее позже, оно с сервера.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort(compareMessages);
}

/** Порядок ленты: по времени, при равенстве — по id, чтобы он был стабильным. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const byTime = a.created_at.localeCompare(b.created_at);
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

export function isOwnMessage(message: ChatMessage, userId: string): boolean {
  return message.author_id === userId;
}

/** Подпись автора: пустое имя в профиле не должно давать пустую строку. */
export function authorNameOf(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  return trimmed ? trimmed : "Участник";
}

/**
 * Показывать ли имя над сообщением. Свои не подписываем — видно по стороне;
 * подряд идущие от того же человека тоже: иначе в переписке из десяти реплик
 * имя повторится десять раз.
 */
export function shouldShowAuthor(
  previous: ChatMessage | null,
  message: ChatMessage,
  userId: string,
): boolean {
  if (isOwnMessage(message, userId)) return false;
  if (!previous) return true;
  return previous.author_id !== message.author_id;
}

/**
 * Непрочитанное: сообщения новее отметки «прочитано», кроме своих.
 * Хранится отметка, а не счётчик, иначе пришлось бы писать каждому участнику
 * на каждое сообщение.
 */
export function unreadCount(
  messages: ChatMessage[],
  lastReadAt: string | null,
  userId: string,
): number {
  return messages.filter(
    (message) =>
      message.author_id !== userId && (lastReadAt === null || message.created_at > lastReadAt),
  ).length;
}

/** Вставка эмодзи в текущую позицию каретки (или вместо выделения). */
export function applyEmoji(
  value: string,
  caretStart: number,
  caretEnd: number,
  emoji: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(caretStart, value.length));
  const end = Math.max(start, Math.min(caretEnd, value.length));
  const next = value.slice(0, start) + emoji + value.slice(end);
  return { value: next, caret: start + emoji.length };
}

/** День сообщения в timezone проекта — YYYY-MM-DD. */
export function messageDay(iso: string, timezone: string): string {
  // en-CA даёт ровно YYYY-MM-DD, без локали браузера в результате.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export type ChatDayGroup = { day: string; label: string; messages: ChatMessage[] };

/**
 * Лента по дням в порядке возрастания времени. Подписи «Сегодня»/«Вчера»
 * считаются в timezone проекта: у сервера и у браузера они могут расходиться.
 */
export function groupMessagesByDay(
  messages: ChatMessage[],
  timezone: string,
  today = todayInTimezone(timezone),
): ChatDayGroup[] {
  const groups = new Map<string, ChatMessage[]>();
  for (const message of [...messages].sort(compareMessages)) {
    const day = messageDay(message.created_at, timezone);
    const list = groups.get(day) ?? [];
    list.push(message);
    groups.set(day, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({
      day,
      label: day === today ? "Сегодня" : day === previousDay(today) ? "Вчера" : formatDateShort(day),
      messages: list,
    }));
}

/** Предыдущий календарный день для строки YYYY-MM-DD (без timezone-сюрпризов). */
function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Время сообщения ЧЧ:ММ в timezone проекта. */
export function messageTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
