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
  activeMentionQuery,
  applyMention,
  attachmentsByMessage,
  authorNameOf,
  canSend,
  escapeLikePattern,
  fromChatRow,
  photoGallery,
  quotePreview,
  highlightParts,
  groupMessagesByDay,
  isEdited,
  isEmojiOnly,
  isNearBottom,
  isOwnMessage,
  jumboSize,
  mapPresence,
  mentionParts,
  searchSnippet,
  mergeAttachments,
  mergeMessages,
  mergeOlderMessages,
  mergeReactions,
  messageTime,
  replacePageAttachments,
  replacePageReactions,
  normalizeBody,
  removeMessage,
  removeMessageAttachments,
  splitAttachments,
  removeMessageReactions,
  removeReaction,
  shouldShowAuthor,
  stepPhotoIndex,
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

describe("история: страницы", () => {
  function attachment(overrides: Partial<ChatAttachment> & { id: string }): ChatAttachment {
    return {
      message_id: "m-1",
      storage_path: "p/1.jpg",
      kind: "image",
      mime_type: "image/jpeg",
      file_name: null,
      size_bytes: 100,
      width: 10,
      height: 10,
      url: "https://example.test/1.jpg",
      ...overrides,
    };
  }

  it("более ранняя страница встаёт перед лентой, а не заменяет её", () => {
    const current = [message({ id: "m-3", created_at: "2026-11-03T10:00:00Z" })];
    const older = [message({ id: "m-2", created_at: "2026-11-03T09:00:00Z" })];

    expect(mergeOlderMessages(current, older).map((item) => item.id)).toEqual(["m-2", "m-3"]);
  });

  it("пересечение страниц схлопывается по id: дубля в ленте нет", () => {
    const current = [
      message({ id: "m-2", created_at: "2026-11-03T09:00:00Z" }),
      message({ id: "m-3", created_at: "2026-11-03T10:00:00Z" }),
    ];
    const older = [
      message({ id: "m-1", created_at: "2026-11-03T08:00:00Z" }),
      message({ id: "m-2", created_at: "2026-11-03T09:00:00Z", body: "с сервера" }),
    ];

    const merged = mergeOlderMessages(current, older);

    expect(merged.map((item) => item.id)).toEqual(["m-1", "m-2", "m-3"]);
    expect(merged[1]?.body).toBe("с сервера");
  });

  it("реакции двух страниц склеиваются без дублей", () => {
    const reaction: ChatReaction = { message_id: "m-1", user_id: "u-1", emoji: "👍" };
    const merged = mergeReactions([reaction], [{ ...reaction }]);

    expect(merged).toHaveLength(1);
  });

  it("дозапрос заменяет реакции только тех сообщений, что пришли в странице", () => {
    const old = { message_id: "m-old", user_id: "u-1", emoji: "🔥" };
    const stale = { message_id: "m-1", user_id: "u-1", emoji: "👍" };
    const fresh = { message_id: "m-1", user_id: "u-2", emoji: "❤️" };

    const result = replacePageReactions([old, stale], [fresh], ["m-1"]);

    expect(result).toEqual([old, fresh]);
  });

  it("вложения склеиваются по id, свежая ссылка побеждает", () => {
    const merged = mergeAttachments(
      [attachment({ id: "a-1", url: "https://example.test/old.jpg" })],
      [attachment({ id: "a-1", url: "https://example.test/new.jpg" })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toBe("https://example.test/new.jpg");
  });

  it("дозапрос заменяет вложения только тех сообщений, что пришли в странице", () => {
    const old = attachment({ id: "a-old", message_id: "m-old" });
    const stale = attachment({ id: "a-1", message_id: "m-1" });
    const fresh = attachment({ id: "a-2", message_id: "m-1" });

    const result = replacePageAttachments([old, stale], [fresh], ["m-1"]);

    expect(result).toEqual([old, fresh]);
  });
});

describe("highlightParts", () => {
  it("находит совпадение без учёта регистра", () => {
    expect(highlightParts("Электроды привезли", "электроды")).toEqual([
      { text: "Электроды", match: true },
      { text: " привезли", match: false },
    ]);
  });

  it("помечает все вхождения", () => {
    const parts = highlightParts("тест и ещё тест", "тест");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["тест", "тест"]);
    expect(parts.map((part) => part.text).join("")).toBe("тест и ещё тест");
  });

  it("пустой запрос — один кусок без совпадения", () => {
    expect(highlightParts("привет", "  ")).toEqual([{ text: "привет", match: false }]);
  });

  it("текст без совпадения остаётся целым", () => {
    expect(highlightParts("привет", "пока")).toEqual([{ text: "привет", match: false }]);
  });

  it("не ломается на спецсимволах", () => {
    expect(highlightParts("скидка 100% и ещё 100%", "100%")).toEqual([
      { text: "скидка ", match: false },
      { text: "100%", match: true },
      { text: " и ещё ", match: false },
      { text: "100%", match: true },
    ]);
  });
});

describe("searchSnippet", () => {
  it("короткий текст отдаёт целиком", () => {
    expect(searchSnippet("Электроды привезли", "электроды")).toBe("Электроды привезли");
  });

  it("склеивает переносы строк в один абзац", () => {
    expect(searchSnippet("первая строка\nвторая", "вторая")).toBe("первая строка вторая");
  });

  it("обрезает длинный текст вокруг совпадения с обеих сторон", () => {
    const body = `${"а".repeat(80)} иголка ${"б".repeat(80)}`;
    const snippet = searchSnippet(body, "иголка", 10);

    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("иголка");
    // Окно — примерно по радиусу с каждой стороны, а не всё сообщение.
    expect(snippet.length).toBeLessThan(40);
  });

  it("длинный текст без совпадения обрезает справа", () => {
    const snippet = searchSnippet("в".repeat(100), "нет", 10);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(21);
  });
});

describe("escapeLikePattern", () => {
  it("экранирует проценты, подчёркивания и обратный слэш", () => {
    expect(escapeLikePattern("100%_все\\")).toBe("100\\%\\_все\\\\");
  });

  it("обычный текст не меняет", () => {
    expect(escapeLikePattern("электроды")).toBe("электроды");
  });
});

describe("mentionParts", () => {
  const names = ["Иван", "Иван Петров", "Станислав Белов"];

  it("находит упоминание и помечает его", () => {
    expect(mentionParts("привет @Иван, глянь", names, null)).toEqual([
      { text: "привет ", mention: false, isMe: false },
      { text: "@Иван", mention: true, isMe: false },
      { text: ", глянь", mention: false, isMe: false },
    ]);
  });

  it("длинное имя выигрывает у короткого", () => {
    const parts = mentionParts("@Иван Петров, ты где", names, null);
    expect(parts[0]).toEqual({ text: "@Иван Петров", mention: true, isMe: false });
  });

  it("регистр не важен", () => {
    expect(mentionParts("@иван", names, null)[0]).toEqual({
      text: "@иван",
      mention: true,
      isMe: false,
    });
  });

  it("помечает упоминание вас", () => {
    const parts = mentionParts("@Станислав Белов", names, "станислав белов");
    expect(parts[0].isMe).toBe(true);
  });

  it("почтовый адрес упоминанием не становится", () => {
    expect(mentionParts("пиши на test@Иван.ru", names, null)).toEqual([
      { text: "пиши на test@Иван.ru", mention: false, isMe: false },
    ]);
  });

  it("часть более длинного имени не считается упоминанием", () => {
    expect(mentionParts("@Иванов", names, null)).toEqual([
      { text: "@Иванов", mention: false, isMe: false },
    ]);
  });

  it("без имён текст не меняется", () => {
    expect(mentionParts("@Иван привет", [], null)).toEqual([
      { text: "@Иван привет", mention: false, isMe: false },
    ]);
  });

  it("несколько упоминаний в одной строке", () => {
    const parts = mentionParts("@Иван и @Станислав Белов", names, null);
    expect(parts.filter((part) => part.mention).map((part) => part.text)).toEqual([
      "@Иван",
      "@Станислав Белов",
    ]);
  });
});

describe("activeMentionQuery", () => {
  it("возвращает набранное после @", () => {
    expect(activeMentionQuery("@Ив", 3)).toBe("Ив");
  });

  it("пустой запрос сразу после @", () => {
    expect(activeMentionQuery("привет @", 8)).toBe("");
  });

  it("находит запрос в середине набранного текста", () => {
    expect(activeMentionQuery("привет @Дм", 10)).toBe("Дм");
  });

  it("внутри слова упоминания нет", () => {
    expect(activeMentionQuery("test@mail", 9)).toBeNull();
  });

  it("после пробела список закрыт", () => {
    expect(activeMentionQuery("@Иван ", 6)).toBeNull();
  });
});

describe("applyMention", () => {
  it("заменяет фрагмент и ставит каретку за именем", () => {
    expect(applyMention("@Ив", 3, "Иван Петров")).toEqual({
      value: "@Иван Петров ",
      caret: 13,
    });
  });

  it("подставляет в середину текста", () => {
    expect(applyMention("привет @Ив, как дела", 10, "Иван")).toEqual({
      value: "привет @Иван, как дела",
      caret: 12,
    });
  });

  it("без @ вставляет имя в позицию каретки", () => {
    expect(applyMention("привет ", 7, "Иван")).toEqual({ value: "привет @Иван ", caret: 13 });
  });
});

describe("fromChatRow", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    author_id: "33333333-3333-4333-8333-333333333333",
    body: "привет",
    created_at: "2026-11-03T10:00:00+00:00",
  };

  it("обычное сообщение без цитаты", () => {
    const message = fromChatRow({ ...base, reply_to_id: null, reply_to_body: null, reply_to_author_id: null });
    expect(message.reply_to).toBeNull();
    expect(message.reply_deleted).toBe(false);
  });

  it("ответ собирает цитату из снимка", () => {
    const message = fromChatRow({
      ...base,
      reply_to_id: "44444444-4444-4444-8444-444444444444",
      reply_to_body: "оригинал",
      reply_to_author_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(message.reply_to).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      body: "оригинал",
      author_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(message.reply_deleted).toBe(false);
  });

  it("удалённый оригинал: ссылки нет, снимок остался", () => {
    const message = fromChatRow({
      ...base,
      reply_to_id: null,
      reply_to_body: "оригинал",
      reply_to_author_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(message.reply_deleted).toBe(true);
    expect(message.reply_to?.body).toBe("оригинал");
  });

  it("пустое тело оригинала — тоже цитата", () => {
    const message = fromChatRow({
      ...base,
      reply_to_id: "44444444-4444-4444-8444-444444444444",
      reply_to_body: "",
      reply_to_author_id: null,
    });
    expect(message.reply_to?.body).toBe("");
    expect(message.reply_deleted).toBe(false);
  });
});

describe("quotePreview", () => {
  it("схлопывает переводы строк", () => {
    expect(quotePreview("первая\nвторая\n\nтретья")).toBe("первая вторая третья");
  });

  it("короткий текст отдаёт целиком", () => {
    expect(quotePreview("коротко")).toBe("коротко");
  });

  it("режет по границе слова и ставит многоточие", () => {
    const long = "слово ".repeat(40);
    const preview = quotePreview(long.trim(), 20);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(21);
    expect(preview).not.toContain("  ");
  });

  it("без пробелов режет по символу", () => {
    expect(quotePreview("а".repeat(30), 10)).toBe(`${"а".repeat(10)}…`);
  });

  it("пустое тело — «Вложение»", () => {
    expect(quotePreview("   ")).toBe("Вложение");
  });
});

describe("просмотрщик фото", () => {
  const shot = (messageId: string, id: string, url: string | null = `https://s/${id}.jpg`): ChatAttachment => ({
    id,
    message_id: messageId,
    storage_path: `p/${messageId}/${id}.jpg`,
    kind: "image",
    mime_type: "image/jpeg",
    file_name: null,
    size_bytes: 2048,
    width: 800,
    height: 600,
    url,
  });

  const doc = (messageId: string, id: string): ChatAttachment => ({
    ...shot(messageId, id),
    kind: "document",
    mime_type: "application/pdf",
    file_name: "смета.pdf",
    width: null,
    height: null,
  });

  it("идёт по порядку сообщений, а не вложений", () => {
    const byMessage = attachmentsByMessage([shot("m-2", "c"), shot("m-1", "a"), shot("m-1", "b")]);
    expect(photoGallery(["m-1", "m-2"], byMessage).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("пропускает документы и неподписанные фото", () => {
    const byMessage = attachmentsByMessage([
      shot("m-1", "a"),
      doc("m-1", "d"),
      shot("m-1", "b", null),
      shot("m-2", "c"),
    ]);
    expect(photoGallery(["m-1", "m-2"], byMessage).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("сообщение без фото и отсутствующее в карте ничего не добавляют", () => {
    const byMessage = attachmentsByMessage([shot("m-2", "c")]);
    expect(photoGallery(["m-1", "m-2", "m-3"], byMessage)).toEqual([
      { id: "c", url: "https://s/c.jpg" },
    ]);
  });

  it("листает по кругу в обе стороны", () => {
    expect(stepPhotoIndex(2, 3, 1)).toBe(0);
    expect(stepPhotoIndex(0, 3, -1)).toBe(2);
    expect(stepPhotoIndex(1, 3, 1)).toBe(2);
    expect(stepPhotoIndex(1, 3, -1)).toBe(0);
  });

  it("одно фото и пустая лента остаются на месте", () => {
    expect(stepPhotoIndex(0, 1, 1)).toBe(0);
    expect(stepPhotoIndex(0, 1, -1)).toBe(0);
    expect(stepPhotoIndex(0, 0, 1)).toBe(0);
  });
});
