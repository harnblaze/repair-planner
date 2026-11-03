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
  /**
   * Есть ли у сообщения файлы. Заполняется только результатами поиска: лента
   * берёт вложения отдельным списком, а строке результата хватает флага.
   */
  has_attachments?: boolean;
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

/**
 * Более ранняя страница истории: те же правила, что у mergeMessages (дедуп по
 * id и порядок по времени), но отдельное имя — у места вызова виден смысл:
 * старые сообщения дописываются в начало, а не заменяют ленту.
 */
export function mergeOlderMessages(current: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  return mergeMessages(current, older);
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
 * Читатель у нижнего края ленты. Порог в пикселях, а не в строках: 48 — это
 * примерно две строки, чтобы «прилипание» не срабатывало от случайного
 * прокрута, но и не заставляло ловить пиксель.
 */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 48,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

/**
 * Инициалы для кружка у чужого сообщения: «Дмитрий» → «Д», «Станислав Белов» →
 * «СБ». Отдельная функция, а не executorsInitials: тот отдаёт «Фамилия И.» для
 * карточек заявок и для одного слова возвращает слово целиком — в аватар оно
 * не влезает.
 */
export function authorInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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

/**
 * Слияние реакций двух страниц истории: дедуп по (сообщение, автор, эмодзи).
 * Пришедшее позже побеждает — как и у сообщений.
 */
export function mergeReactions(current: ChatReaction[], incoming: ChatReaction[]): ChatReaction[] {
  const key = (item: ChatReaction) => `${item.message_id}|${item.user_id}|${item.emoji}`;
  const byKey = new Map<string, ChatReaction>();
  for (const item of current) byKey.set(key(item), item);
  for (const item of incoming) byKey.set(key(item), item);
  return [...byKey.values()];
}

/**
 * Реакции страницы после дозапроса: у сообщений этой страницы сервер — истина
 * (реакцию могли снять с другого устройства), у ранее догруженной истории
 * записи остаются как были — иначе они бы исчезали при каждом опросе.
 */
export function replacePageReactions(
  current: ChatReaction[],
  incoming: ChatReaction[],
  pageIds: readonly string[],
): ChatReaction[] {
  const page = new Set(pageIds);
  return [...current.filter((item) => !page.has(item.message_id)), ...incoming];
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

/**
 * Слияние вложений двух страниц: дедуп по id, пришедшее позже побеждает.
 * Это важно для ссылок: подписанная живёт час, и свежая должна заменить старую.
 */
export function mergeAttachments(
  current: readonly ChatAttachment[],
  incoming: readonly ChatAttachment[],
): ChatAttachment[] {
  const byId = new Map<string, ChatAttachment>();
  for (const item of current) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/** Вложения страницы после дозапроса: см. replacePageReactions. */
export function replacePageAttachments(
  current: readonly ChatAttachment[],
  incoming: readonly ChatAttachment[],
  pageIds: readonly string[],
): ChatAttachment[] {
  const page = new Set(pageIds);
  return [...current.filter((item) => !page.has(item.message_id)), ...incoming];
}

/** До четырёх фото в ряд: одно — крупно, несколько — сеткой (классы Tailwind). */
export function attachmentGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  return "grid-cols-2";
}

// ── Поиск по переписке ───────────────────────────────────────────────────────

/**
 * Экранирование шаблона LIKE для поиска по тексту. Без него пользовательские
 * «%» и «_» работают как wildcard: запрос «100%» нашёл бы все сообщения, а
 * «тест_поиска» — любое слово из шести букв вместо буквального совпадения.
 * Обратный слэш экранируется первым, иначе он съел бы наши же слэши.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Кусок текста: `match` — попал ли он в найденное вхождение. */
export type TextPart = { text: string; match: boolean };

/**
 * Разбивает текст на куски по вхождениям запроса, без учёта регистра.
 * Возвращает данные, а не разметку: подсветку рисует компонент, поэтому
 * экранировать пользовательский текст здесь не нужно.
 */
export function highlightParts(text: string, query: string): TextPart[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const parts: TextPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (found > cursor) parts.push({ text: text.slice(cursor, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
  }

  return parts.length > 0 ? parts : [{ text, match: false }];
}

/**
 * Окно вокруг первого совпадения: в результатах поиска нужен контекст, а не
 * всё сообщение на 2000 символов. Короткий текст отдаётся целиком, обрезанные
 * края помечаются многоточием.
 */
export function searchSnippet(body: string, query: string, radius = 40): string {
  // Переносы строк в строке результата ломают вёрстку — склеиваем в один абзац.
  const flat = body.replace(/\s+/g, " ").trim();
  const needle = query.trim().toLowerCase();
  const at = needle.length > 0 ? flat.toLowerCase().indexOf(needle) : -1;

  if (at === -1) {
    return flat.length <= radius * 2 ? flat : `${flat.slice(0, radius * 2).trimEnd()}…`;
  }

  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + needle.length + radius);

  // Окно режем по границам слов: обрывок «…ра с утра» читается как опечатка.
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space !== -1 && space > at + needle.length) end = space;
  }

  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** Буква, цифра или подчёркивание — то, что делает «@» частью слова или адреса. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Кусок текста сообщения: обычный текст, упоминание другого или упоминание вас. */
export type MentionPart = { text: string; mention: boolean; isMe: boolean };

/**
 * Разбор упоминаний `@Имя` по списку известных имён участников.
 *
 * Имена — данные, а не разметка: в базе лежит обычный текст, поэтому чип
 * упоминания рисует компонент. Самое длинное имя проверяется первым, иначе
 * «Иван» съел бы начало «Иван Петров». Границы с двух сторон обязательны:
 * так `test@mail.ru` и «Иванов» (при участнике «Иван») упоминаниями не станут.
 */
export function mentionParts(
  text: string,
  names: readonly string[],
  myName: string | null,
): MentionPart[] {
  const known = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))]
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, lower: name.toLowerCase() }));

  if (known.length === 0 || !text.includes("@")) {
    return [{ text, mention: false, isMe: false }];
  }

  const me = myName?.trim().toLowerCase() ?? null;
  const parts: MentionPart[] = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain.length === 0) return;
    parts.push({ text: plain, mention: false, isMe: false });
    plain = "";
  };

  while (index < text.length) {
    const char = text[index];
    const before = index > 0 ? text[index - 1] : "";
    if (char !== "@" || (before.length > 0 && WORD_CHAR.test(before))) {
      plain += char;
      index += 1;
      continue;
    }

    const matched = known.find(({ name, lower }) => {
      const candidate = text.slice(index + 1, index + 1 + name.length);
      if (candidate.toLowerCase() !== lower) return false;
      const after = text[index + 1 + name.length] ?? "";
      return after.length === 0 || !WORD_CHAR.test(after);
    });

    if (!matched) {
      plain += char;
      index += 1;
      continue;
    }

    flush();
    parts.push({
      text: text.slice(index, index + 1 + matched.name.length),
      mention: true,
      isMe: me !== null && matched.lower === me,
    });
    index += 1 + matched.name.length;
  }

  flush();
  return parts.length > 0 ? parts : [{ text, mention: false, isMe: false }];
}

/**
 * Что набрано после «@» под кареткой. Возвращает null, если каретка не внутри
 * упоминания: `@` должен начинать слово, иначе адрес почты открывал бы список.
 */
export function activeMentionQuery(text: string, caret: number): string | null {
  const at = Math.max(0, Math.min(caret, text.length));
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(text.slice(0, at));
  return match ? match[1] : null;
}

/**
 * Подстановка выбранного имени вместо набранного фрагмента. Каретка встаёт
 * сразу за именем. Пробел добавляется, только если дальше идёт текст: перед
 * запятой или уже стоящим пробелом он дал бы «@Иван ,».
 */
export function applyMention(
  text: string,
  caret: number,
  name: string,
): { value: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(text.slice(0, at));
  const start = match ? at - match[1].length - 1 : at;
  const rest = text.slice(at);
  const space = /^[\s,.;:!?…)\]]/u.test(rest) ? "" : " ";
  return {
    value: `${text.slice(0, start)}@${name}${space}${rest}`,
    caret: start + name.length + 1 + space.length,
  };
}
