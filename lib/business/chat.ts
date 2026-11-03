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
  /** Когда сообщение правили (0036); null/undefined — не правили ни разу. */
  edited_at?: string | null;
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

/** Правили ли сообщение: отметку ставит триггер, клиент её только читает. */
export function isEdited(message: ChatMessage): boolean {
  return Boolean(message.edited_at);
}

/**
 * Убрать сообщение из ленты. Вместе с ним уходят его реакции: иначе после
 * удаления в состоянии остались бы чипы, ведущие в никуда.
 */
export function removeMessage(messages: ChatMessage[], id: string): ChatMessage[] {
  return messages.filter((message) => message.id !== id);
}

export function removeMessageReactions(reactions: ChatReaction[], id: string): ChatReaction[] {
  return reactions.filter((reaction) => reaction.message_id !== id);
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

// ── Реакции ──────────────────────────────────────────────────────────────────

/**
 * Набор реакций в порядке показа. Тот же список лежит в CHECK миграции 0035;
 * тест сверяет их, чтобы база и код не разъехались. Живёт здесь, а не в
 * lib/validation/chat.ts: тот файл тянет zod, а виджету нужен только набор.
 */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "🔧", "👀"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** Строка реакции: из БД или оптимистичная (тогда created_at не нужен). */
export type ChatReaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at?: string;
};

export type ReactionSummary = { emoji: string; count: number; mine: boolean };

/**
 * Сводка по ОДНОМУ сообщению: реакции приходят уже отфильтрованными по
 * message_id, поэтому самого сообщения в параметрах нет. Порядок — как в
 * REACTION_EMOJI, а не по времени: кнопки не должны прыгать от каждого клика.
 */
export function summarizeReactions(reactions: ChatReaction[], userId: string): ReactionSummary[] {
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const entry = counts.get(reaction.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (reaction.user_id === userId) entry.mine = true;
    counts.set(reaction.emoji, entry);
  }

  return REACTION_EMOJI.flatMap((emoji) => {
    const entry = counts.get(emoji);
    return entry ? [{ emoji, count: entry.count, mine: entry.mine }] : [];
  });
}

/** Оптимистичное переключение своей реакции: поставили — сняли — снова поставили. */
export function toggleReaction(
  reactions: ChatReaction[],
  messageId: string,
  emoji: string,
  userId: string,
): ChatReaction[] {
  const own = (reaction: ChatReaction) =>
    reaction.message_id === messageId && reaction.emoji === emoji && reaction.user_id === userId;

  if (reactions.some(own)) {
    return reactions.filter((reaction) => !own(reaction));
  }
  return [...reactions, { message_id: messageId, user_id: userId, emoji }];
}

/**
 * Идемпотентное добавление: событие Realtime может прийти и после того, как мы
 * уже поставили реакцию оптимистично. Дубль не должен дать две единицы в счётчике.
 */
export function addReaction(reactions: ChatReaction[], reaction: ChatReaction): ChatReaction[] {
  const same = (item: ChatReaction) =>
    item.message_id === reaction.message_id &&
    item.user_id === reaction.user_id &&
    item.emoji === reaction.emoji;
  return reactions.some(same) ? reactions : [...reactions, reaction];
}

/** Идемпотентное снятие: повторный DELETE-событие ничего не ломает. */
export function removeReaction(reactions: ChatReaction[], reaction: ChatReaction): ChatReaction[] {
  return reactions.filter(
    (item) =>
      !(
        item.message_id === reaction.message_id &&
        item.user_id === reaction.user_id &&
        item.emoji === reaction.emoji
      ),
  );
}

// ── Кто онлайн (Realtime Presence) ───────────────────────────────────────────

/** Что клиент кладёт в track(); ответ presenceState() — массив таких записей. */
export type PresenceEntry = { user_id?: string; full_name?: string };
export type OnlineUser = { userId: string; fullName: string };

/**
 * Presence живёт только в памяти канала: «онлайн» — это открытая вкладка
 * проекта, а не запись в базе. Повторы по одному ключу схлопываем (человек с
 * двумя вкладками — один онлайн), безымянных не теряем: подпись «Участник».
 */
export function mapPresence(state: Record<string, PresenceEntry[]>): OnlineUser[] {
  const byId = new Map<string, string>();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      if (!entry?.user_id) continue;
      byId.set(entry.user_id, entry.full_name?.trim() || "Участник");
    }
  }
  return [...byId.entries()]
    .map(([userId, fullName]) => ({ userId, fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}

// ── «Крупный эмодзи» ─────────────────────────────────────────────────────────

/**
 * Из чего состоит одна эмодзи-графема: пиктограмма, variation selector (❤️),
 * ZWJ-склейка (👨‍👩‍👧‍👦), скинтон и keycap-рамка.
 */
const EMOJI_GRAPHEME = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}]|\u20E3)+$/u;
const HAS_PICTOGRAPH = /\p{Extended_Pictographic}/u;

/** Сколько эмодзи в сообщении; пробелы по краям и между ними не считаются. */
const EMOJI_ONLY_MAX = 3;

function graphemes(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  // Intl.Segmenter держит 👨‍👩‍👧‍👦 и ❤️ одной графемой; без него ZWJ-семейство
  // распадается на четыре пиктограммы и «крупный эмодзи» включился бы зря.
  return [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(trimmed)]
    .map((part) => part.segment)
    .filter((part) => part.trim().length > 0);
}

/** Сообщение состоит только из эмодзи (1–3 штуки) и ни из чего больше. */
export function isEmojiOnly(body: string): boolean {
  const parts = graphemes(body);
  if (parts.length < 1 || parts.length > EMOJI_ONLY_MAX) return false;
  return parts.every((part) => EMOJI_GRAPHEME.test(part) && HAS_PICTOGRAPH.test(part));
}

/** Класс размера для «крупного эмодзи» или null, если сообщение обычное. */
export function jumboSize(body: string): string | null {
  if (!isEmojiOnly(body)) return null;
  return graphemes(body).length === 1 ? "text-[30px] leading-[1.1]" : "text-[22px] leading-[1.2]";
}

// ── Вложения ─────────────────────────────────────────────────────────────────

/** Вложение сообщения в том виде, в каком его рисует лента: фото или документ. */
export type ChatAttachment = {
  id: string;
  message_id: string;
  storage_path: string;
  /** image — миниатюра, document — карточка файла со скачиванием. */
  kind: "image" | "document";
  mime_type: string | null;
  /** Имя файла для карточки; у фото его нет. */
  file_name: string | null;
  size_bytes: number;
  /** Размеры есть только у фото: у документа их не существует. */
  width: number | null;
  height: number | null;
  /** Подписанная ссылка на просмотр/скачивание; null — подписать не удалось. */
  url: string | null;
};

/** Фото отдельно от документов: в ленте они рисуются по-разному. */
export function splitAttachments(list: readonly ChatAttachment[]): {
  images: ChatAttachment[];
  files: ChatAttachment[];
} {
  const images: ChatAttachment[] = [];
  const files: ChatAttachment[] = [];
  for (const item of list) {
    if (item.kind === "document") files.push(item);
    else images.push(item);
  }
  return { images, files };
}

/** Фото по сообщениям: одна проходка вместо поиска по массиву на каждую строку. */
export function attachmentsByMessage(
  list: readonly ChatAttachment[],
): Map<string, ChatAttachment[]> {
  const map = new Map<string, ChatAttachment[]>();
  for (const item of list) {
    const group = map.get(item.message_id) ?? [];
    group.push(item);
    map.set(item.message_id, group);
  }
  return map;
}

/** Убрать фото удалённого сообщения. */
export function removeMessageAttachments(
  list: readonly ChatAttachment[],
  messageId: string,
): ChatAttachment[] {
  return list.filter((item) => item.message_id !== messageId);
}

/** До четырёх фото в ряд: одно — крупно, несколько — сеткой (классы Tailwind). */
export function attachmentGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  return "grid-cols-2";
}
