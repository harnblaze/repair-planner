import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ChatAttachment,
  REACTION_EMOJI,
  addReaction,
  applyEmoji,
  authorInitials,
  attachmentGridClass,
  attachmentsByMessage,
  authorNameOf,
  canSend,
  groupMessagesByDay,
  isEdited,
  isEmojiOnly,
  isNearBottom,
  isOwnMessage,
  jumboSize,
  mapPresence,
  mergeMessages,
  messageTime,
  normalizeBody,
  removeMessage,
  removeMessageAttachments,
  splitAttachments,
  removeMessageReactions,
  removeReaction,
  shouldShowAuthor,
  summarizeReactions,
  toggleReaction,
  unreadCount,
  type ChatMessage,
  type ChatReaction,
} from "./chat";
import { EMOJI_CATEGORIES, recentEmoji } from "./emoji";

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    project_id: "p-1",
    author_id: "u-1",
    body: "текст",
    created_at: "2026-11-03T10:00:00Z",
    ...overrides,
  };
}

describe("склейка ленты", () => {
  it("дубль по id схлопывается: оптимистичная вставка и Realtime — одна строка", () => {
    const optimistic = message({ id: "m-1", created_at: "2026-11-03T10:00:00Z" });
    const fromRealtime = message({ id: "m-1", created_at: "2026-11-03T10:00:00Z", body: "текст" });

    expect(mergeMessages([optimistic], [fromRealtime])).toHaveLength(1);
  });

  it("версия с сервера побеждает оптимистичную", () => {
    const merged = mergeMessages(
      [message({ id: "m-1", body: "как набрал" })],
      [message({ id: "m-1", body: "как сохранилось" })],
    );

    expect(merged[0]?.body).toBe("как сохранилось");
  });

  it("порядок по времени, при равенстве — по id", () => {
    const merged = mergeMessages(
      [],
      [
        message({ id: "b", created_at: "2026-11-03T10:00:02Z" }),
        message({ id: "a", created_at: "2026-11-03T10:00:01Z" }),
        message({ id: "c", created_at: "2026-11-03T10:00:01Z" }),
      ],
    );

    expect(merged.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("своё сообщение распознаётся по автору", () => {
    expect(isOwnMessage(message({ id: "m-1", author_id: "u-1" }), "u-1")).toBe(true);
    expect(isOwnMessage(message({ id: "m-1", author_id: "u-2" }), "u-1")).toBe(false);
  });
});

describe("подпись автора", () => {
  const first = message({ id: "1", author_id: "u-2", created_at: "2026-11-03T09:00:00Z" });
  const second = message({ id: "2", author_id: "u-2", created_at: "2026-11-03T09:01:00Z" });
  const other = message({ id: "3", author_id: "u-3", created_at: "2026-11-03T09:02:00Z" });
  const own = message({ id: "4", author_id: "u-1", created_at: "2026-11-03T09:03:00Z" });

  it("имя показывается над первой репликой подряд", () => {
    expect(shouldShowAuthor(null, first, "u-1")).toBe(true);
    expect(shouldShowAuthor(first, second, "u-1")).toBe(false);
  });

  it("смена автора снова показывает имя", () => {
    expect(shouldShowAuthor(second, other, "u-1")).toBe(true);
    expect(shouldShowAuthor(other, own, "u-1")).toBe(false);
  });

  it("свои сообщения не подписываются никогда", () => {
    expect(shouldShowAuthor(first, own, "u-1")).toBe(false);
  });

  it("пустое имя в профиле превращается в «Участник»", () => {
    expect(authorNameOf("  Станислав Белов ")).toBe("Станислав Белов");
    expect(authorNameOf(null)).toBe("Участник");
    expect(authorNameOf("   ")).toBe("Участник");
  });

  it("в аватар идут инициалы, а не имя целиком", () => {
    expect(authorInitials("Дмитрий")).toBe("Д");
    expect(authorInitials("Станислав Белов")).toBe("СБ");
    expect(authorInitials("белов станислав иванович")).toBe("БС");
    expect(authorInitials(null)).toBe("?");
    expect(authorInitials("   ")).toBe("?");
  });
});

describe("непрочитанное", () => {
  const messages = [
    message({ id: "1", author_id: "u-2", created_at: "2026-11-03T09:00:00Z" }),
    message({ id: "2", author_id: "u-1", created_at: "2026-11-03T09:30:00Z" }),
    message({ id: "3", author_id: "u-2", created_at: "2026-11-03T10:00:00Z" }),
  ];

  it("считает чужие сообщения новее отметки", () => {
    // 09:00 — до отметки, 10:00 — после; 09:30 своё.
    expect(unreadCount(messages, "2026-11-03T09:15:00Z", "u-1")).toBe(1);
  });

  it("свои сообщения не считаются", () => {
    expect(unreadCount(messages, null, "u-1")).toBe(2);
  });

  it("после прочтения всего — ноль", () => {
    expect(unreadCount(messages, "2026-11-03T10:05:00Z", "u-1")).toBe(0);
  });
});

describe("вставка эмодзи", () => {
  it("в конец строки", () => {
    expect(applyEmoji("Привет", 6, 6, "🙂")).toEqual({ value: "Привет🙂", caret: 8 });
  });

  it("в середину — по позиции каретки", () => {
    expect(applyEmoji("Привет мир", 6, 6, "🔥")).toEqual({ value: "Привет🔥 мир", caret: 8 });
  });

  it("выделение заменяется", () => {
    expect(applyEmoji("Привет мир", 0, 6, "👋")).toEqual({ value: "👋 мир", caret: 2 });
  });

  it("каретка за границей строки не ломает вставку", () => {
    // «✅» — один UTF-16 код, поэтому каретка встаёт на 4.
    expect(applyEmoji("abc", 99, 99, "✅")).toEqual({ value: "abc✅", caret: 4 });
  });
});

describe("правила отправки", () => {
  it("пустое и пробельное не отправляется", () => {
    expect(canSend("")).toBe(false);
    expect(canSend("   \n ")).toBe(false);
  });

  it("обычный текст отправляется, крайние пробелы срезаются", () => {
    expect(canSend("  привет  ")).toBe(true);
    expect(normalizeBody("  привет  ")).toBe("привет");
  });

  it("границы длины — как CHECK в БД", () => {
    expect(canSend("a".repeat(2000))).toBe(true);
    expect(canSend("a".repeat(2001))).toBe(false);
  });
});

describe("лента по дням", () => {
  it("подписи считаются в timezone проекта", () => {
    const groups = groupMessagesByDay(
      [
        message({ id: "1", created_at: "2026-11-02T20:00:00Z" }),
        message({ id: "2", created_at: "2026-11-03T08:00:00Z" }),
      ],
      "Europe/Moscow",
      "2026-11-03",
    );

    expect(groups.map((group) => group.label)).toEqual(["Вчера", "Сегодня"]);
  });

  it("сообщение вечера по Москве попадает в следующий день", () => {
    const groups = groupMessagesByDay(
      [message({ id: "1", created_at: "2026-11-02T22:30:00Z" })],
      "Europe/Moscow",
      "2026-11-03",
    );

    expect(groups[0]?.label).toBe("Сегодня");
    expect(groups[0]?.day).toBe("2026-11-03");
  });

  it("время сообщения — в timezone проекта", () => {
    expect(messageTime("2026-11-03T07:05:00Z", "Europe/Moscow")).toBe("10:05");
  });
});

describe("набор эмодзи", () => {
  it("в наборе достаточно эмодзи и нет пустых категорий", () => {
    const total = EMOJI_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(150);
    expect(EMOJI_CATEGORIES.every((category) => category.items.length > 0)).toBe(true);
  });

  it("повтор сдвигает эмодзи в конец, а не дублирует", () => {
    expect(recentEmoji(["😀", "🔥", "👍"], "🔥")).toEqual(["😀", "👍", "🔥"]);
  });

  it("хвост ограничен восемью", () => {
    const list = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    expect(recentEmoji(list, "10")).toHaveLength(8);
  });
});

describe("реакции", () => {
  const list: ChatReaction[] = [
    { message_id: "m1", user_id: "u1", emoji: "❤️" },
    { message_id: "m1", user_id: "u2", emoji: "❤️" },
    { message_id: "m1", user_id: "u2", emoji: "👍" },
  ];

  it("суммирует по эмодзи и отмечает свою", () => {
    const summary = summarizeReactions(list, "u1");
    expect(summary).toEqual([
      { emoji: "👍", count: 1, mine: false },
      { emoji: "❤️", count: 2, mine: true },
    ]);
  });

  it("порядок — по набору, а не по времени прихода", () => {
    const reversed = [...list].reverse();
    expect(summarizeReactions(reversed, "u1").map((item) => item.emoji)).toEqual(["👍", "❤️"]);
  });

  it("пустая реакция не попадает в сводку", () => {
    expect(summarizeReactions([], "u1")).toEqual([]);
  });

  it("toggle ставит и снимает свою реакцию", () => {
    const added = toggleReaction([], "m1", "🎉", "u1");
    expect(added).toHaveLength(1);
    expect(toggleReaction(added, "m1", "🎉", "u1")).toEqual([]);
  });

  it("чужая реакция не снимается моим переключением", () => {
    const next = toggleReaction([{ message_id: "m1", user_id: "u2", emoji: "👍" }], "m1", "👍", "u1");
    expect(next).toHaveLength(2);
    expect(next.some((reaction) => reaction.user_id === "u2")).toBe(true);
  });

  it("исходный массив не мутируется", () => {
    const source: ChatReaction[] = [{ message_id: "m1", user_id: "u2", emoji: "👍" }];
    toggleReaction(source, "m1", "👍", "u1");
    expect(source).toHaveLength(1);
  });
});

describe("крупный эмодзи", () => {
  it("один эмодзи — крупный, включая ZWJ-семейство и ❤️", () => {
    expect(isEmojiOnly("👍")).toBe(true);
    expect(isEmojiOnly("👨‍👩‍👧‍👦")).toBe(true);
    expect(isEmojiOnly("❤️")).toBe(true);
    expect(isEmojiOnly("  👍  ")).toBe(true);
  });

  it("до трёх эмодзи вместе — ещё крупный", () => {
    expect(isEmojiOnly("👍❤️🎉")).toBe(true);
    // Кегли подобраны под узкую панель чата (364 px): 34 px выглядели плашкой.
    expect(jumboSize("👍")).toBe("text-[30px] leading-[1.1]");
    expect(jumboSize("👍❤️")).toBe("text-[22px] leading-[1.2]");
  });

  it("эмодзи с текстом и просто текст — не крупный", () => {
    expect(isEmojiOnly("👍 ок")).toBe(false);
    expect(isEmojiOnly("привет")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
    expect(isEmojiOnly("   ")).toBe(false);
    expect(jumboSize("👍 ок")).toBeNull();
  });

  it("больше трёх эмодзи — обычный размер", () => {
    expect(isEmojiOnly("👍❤️🎉😂")).toBe(false);
    expect(jumboSize("👍❤️🎉😂")).toBeNull();
  });
});

describe("набор реакций совпадает с CHECK в миграции", () => {
  // База и код должны держать один список: иначе UI предложит эмодзи,
  // который CHECK отвергнет, и пользователь увидит ошибку вместо реакции.
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0035_message_reactions.sql"), "utf8");
  const check = /emoji in \(([^)]*)\)/i.exec(sql)?.[1] ?? "";
  const fromSql = [...check.matchAll(/'([^']+)'/g)].map((match) => match[1]);

  it("в миграции нашлись эмодзи", () => {
    expect(fromSql).toHaveLength(REACTION_EMOJI.length);
  });

  it("списки совпадают", () => {
    expect([...fromSql].sort()).toEqual([...REACTION_EMOJI].sort());
  });
});

describe("реакции из Realtime", () => {
  const own = { message_id: "m-1", user_id: "u-1", emoji: "👍" };

  it("повторное добавление не даёт двух единиц в счётчике", () => {
    const once = addReaction([], own);
    const twice = addReaction(once, own);
    expect(twice).toHaveLength(1);
  });

  it("добавление чужой реакции не схлопывается с моей", () => {
    const list = addReaction(addReaction([], own), { ...own, user_id: "u-2" });
    expect(summarizeReactions(list, "u-1")).toEqual([{ emoji: "👍", count: 2, mine: true }]);
  });

  it("повторное удаление ничего не ломает", () => {
    const list = addReaction([], own);
    expect(removeReaction(removeReaction(list, own), own)).toHaveLength(0);
  });

  it("удаление чужой реакции мою не трогает", () => {
    const list = addReaction(addReaction([], own), { ...own, user_id: "u-2" });
    const left = removeReaction(list, { ...own, user_id: "u-2" });
    expect(left).toHaveLength(1);
    expect(left[0].user_id).toBe("u-1");
  });
});

describe("кто онлайн", () => {
  it("схлопывает две вкладки одного человека", () => {
    const online = mapPresence({
      "u-1": [{ user_id: "u-1", full_name: "Станислав Белов" }],
      "u-1-tab2": [{ user_id: "u-1", full_name: "Станислав Белов" }],
      "u-2": [{ user_id: "u-2", full_name: "Дмитрий" }],
    });
    expect(online).toHaveLength(2);
    expect(online.map((user) => user.userId).sort()).toEqual(["u-1", "u-2"]);
  });

  it("без имени подписывает «Участник», а не пустой строкой", () => {
    expect(mapPresence({ a: [{ user_id: "u-3" }] })).toEqual([
      { userId: "u-3", fullName: "Участник" },
    ]);
  });

  it("сортирует по имени и пропускает записи без пользователя", () => {
    const online = mapPresence({
      a: [{ user_id: "u-2", full_name: "Борис" }],
      b: [{ user_id: "u-1", full_name: "Анна" }],
      c: [{}],
    });
    expect(online.map((user) => user.fullName)).toEqual(["Анна", "Борис"]);
  });

  it("пустое состояние — пустой список", () => {
    expect(mapPresence({})).toEqual([]);
  });
});

describe("правка и удаление", () => {
  it("сообщение без edited_at считается неправленым", () => {
    expect(isEdited(message({ id: "1" }))).toBe(false);
    expect(isEdited(message({ id: "2", edited_at: null }))).toBe(false);
    expect(isEdited(message({ id: "3", edited_at: "2026-11-03T10:00:00Z" }))).toBe(true);
  });

  it("удаление убирает только своё сообщение и не мутирует исходный список", () => {
    const first = message({ id: "1", created_at: "2026-11-03T09:00:00Z" });
    const second = message({ id: "2", created_at: "2026-11-03T09:01:00Z" });
    const list = [first, second];

    expect(removeMessage(list, "1")).toEqual([second]);
    expect(list).toHaveLength(2);
  });

  it("вместе с сообщением уходят только его реакции", () => {
    const reactions: ChatReaction[] = [
      { message_id: "1", user_id: "u-1", emoji: "👍" },
      { message_id: "1", user_id: "u-2", emoji: "🔧" },
      { message_id: "2", user_id: "u-1", emoji: "❤️" },
    ];

    expect(removeMessageReactions(reactions, "1")).toEqual([
      { message_id: "2", user_id: "u-1", emoji: "❤️" },
    ]);
  });

  it("пустую правку сохранить нельзя — те же правила, что при отправке", () => {
    expect(canSend(normalizeBody("   \n  "))).toBe(false);
    expect(canSend(normalizeBody("  исправленный текст  "))).toBe(true);
  });
});

describe("вложения", () => {
  const photo = (messageId: string, id: string): ChatAttachment => ({
    id,
    message_id: messageId,
    storage_path: `p/${messageId}/${id}.jpg`,
    kind: "image",
    mime_type: "image/jpeg",
    file_name: `${id}.jpg`,
    size_bytes: 1024,
    width: 100,
    height: 80,
    url: null,
  });

  const document = (messageId: string, id: string): ChatAttachment => ({
    id,
    message_id: messageId,
    storage_path: `p/${messageId}/${id}.pdf`,
    kind: "document",
    mime_type: "application/pdf",
    file_name: "смета.pdf",
    size_bytes: 240_000,
    width: null,
    height: null,
    url: null,
  });

  it("делит вложения на фото и документы", () => {
    const { images, files } = splitAttachments([photo("m-1", "a"), document("m-1", "b")]);
    expect(images.map((item) => item.id)).toEqual(["a"]);
    expect(files.map((item) => item.id)).toEqual(["b"]);
  });

  it("группирует фото по сообщениям", () => {
    const map = attachmentsByMessage([photo("m-1", "a"), photo("m-1", "b"), photo("m-2", "c")]);
    expect(map.get("m-1")?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(map.get("m-2")?.map((item) => item.id)).toEqual(["c"]);
    expect(map.get("m-3")).toBeUndefined();
  });

  it("убирает фото удалённого сообщения, не трогая остальные", () => {
    const list = [photo("m-1", "a"), photo("m-2", "b")];
    expect(removeMessageAttachments(list, "m-1").map((item) => item.id)).toEqual(["b"]);
  });

  it("одно фото — одна колонка, несколько — две", () => {
    expect(attachmentGridClass(1)).toBe("grid-cols-1");
    expect(attachmentGridClass(2)).toBe("grid-cols-2");
    expect(attachmentGridClass(4)).toBe("grid-cols-2");
  });
});

describe("лента: прилипание к низу", () => {
  it("в самом низу — да", () => {
    expect(isNearBottom(500, 1000, 500)).toBe(true);
  });

  it("почти у низа — да, в пределах порога", () => {
    expect(isNearBottom(470, 1000, 500)).toBe(true);
  });

  it("пролистал вверх — нет", () => {
    expect(isNearBottom(200, 1000, 500)).toBe(false);
  });

  it("лента короче окна — считаем, что внизу", () => {
    expect(isNearBottom(0, 300, 500)).toBe(true);
  });
});
