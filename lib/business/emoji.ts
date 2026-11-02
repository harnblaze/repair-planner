// Эмодзи для чата: свой набор, без зависимостей. Набор намеренно короткий —
// длинный пикер в узкой панели неудобен, а «часто используемые» закрывают
// повседневные реакции.

export type EmojiCategory = { id: string; label: string; items: string[] };

/** Хвост последних эмодзи: без повторов, свежие в конце. */
export const RECENT_MAX = 8;

const STORAGE_KEY = "chat:recent-emoji";

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "emotions",
    label: "Эмоции",
    items: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
      "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
      "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳",
      "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", "😫",
      "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳",
      "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭",
      "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧",
      "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢",
      "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👻",
      "💀", "☠️", "👽", "🤖", "💩", "😺", "😸", "😹", "😻", "😼",
    ],
  },
  {
    id: "gestures",
    label: "Жесты",
    items: [
      "👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙",
      "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋",
      "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🫡", "🫶", "👏",
      "🙌", "👐", "🤲", "🤜", "🤛", "✊", "👊", "🫸", "🫷", "🤝",
    ],
  },
  {
    id: "work",
    label: "Работа",
    items: [
      "🔧", "🔨", "⛏️", "🪚", "🪛", "🔩", "⚙️", "🪤", "🧰", "🧲",
      "🪜", "🚧", "🏗️", "🏭", "🧱", "🪨", "🪵", "📐", "📏", "📎",
      "📌", "📍", "🖊️", "🖍️", "✏️", "📝", "📋", "📄", "📁", "🗂️",
      "📦", "🚚", "🚛", "🏠", "🏢", "🛠️", "💡", "🔌", "🔋", "🧯",
      "🪣", "🧹", "🧽", "🚿", "🚽", "🔑", "🗝️", "🔒", "🔓", "⏰",
    ],
  },
  {
    id: "food",
    label: "Еда",
    items: [
      "☕", "🍵", "🥤", "🧃", "🍺", "🍻", "🥂", "🍷", "🍔", "🍟",
      "🍕", "🌮", "🌯", "🥙", "🥪", "🍞", "🥐", "🥨", "🧀", "🥚",
      "🍳", "🥞", "🍲", "🍜", "🍝", "🍚", "🍛", "🥘", "🥗", "🍎",
      "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🍑",
    ],
  },
  {
    id: "other",
    label: "Разное",
    items: [
      "❗", "❓", "‼️", "⁉️", "✅", "☑️", "✔️", "❌", "⛔", "🚫",
      "⚠️", "🔔", "🔕", "📢", "📣", "💬", "💭", "🗯️", "🕐", "⏳",
      "⌛", "📅", "📆", "🗓️", "🌡️", "☀️", "🌤️", "🌧️", "❄️", "🌨️",
      "🔥", "💧", "⚡", "🌈", "⭐", "🌟", "✨", "💥", "❤️", "🧡",
      "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "🎉", "🎊",
      "🎁", "🏆", "🥇", "🎯", "🚀", "🛑", "🆗", "🆘", "🔁", "➕",
    ],
  },
];

/** Плоский список всех эмодзи набора — для проверок и поиска. */
export const ALL_EMOJI: string[] = EMOJI_CATEGORIES.flatMap((category) => category.items);

/** Хвост последних: повтор сдвигает эмодзи в конец, а не дублирует его. */
export function recentEmoji(list: string[], emoji: string): string[] {
  const without = list.filter((item) => item !== emoji);
  return [...without, emoji].slice(-RECENT_MAX);
}

/** Последние эмодзи из localStorage; в SSR и при запрете хранилища — пусто. */
export function readRecentEmoji(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(-RECENT_MAX);
  } catch {
    return [];
  }
}

export function saveRecentEmoji(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-RECENT_MAX)));
  } catch {
    // Приватный режим и переполненное хранилище не должны ломать отправку.
  }
}
