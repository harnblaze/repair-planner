import { describe, expect, it } from "vitest";

import {
  PUSH_BODY_LIMIT,
  chatPushPayload,
  pushBody,
  testPushPayload,
  urlBase64ToUint8Array,
} from "./push";

describe("pushBody", () => {
  it("схлопывает переводы строк и лишние пробелы", () => {
    expect(pushBody("первая\nвторая   строка")).toBe("первая вторая строка");
  });

  it("пустое тело не оставляет пустое уведомление", () => {
    expect(pushBody("   \n  ")).toBe("Новое сообщение");
  });

  it("короткий текст отдаёт целиком", () => {
    expect(pushBody("Коротко")).toBe("Коротко");
  });

  it("длинный режет по границе слова и ставит многоточие", () => {
    const text = "слово ".repeat(60).trim();
    const body = pushBody(text);
    expect(body.length).toBeLessThanOrEqual(PUSH_BODY_LIMIT + 1);
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toContain("слов…");
  });

  it("без пробелов режет по символу", () => {
    expect(pushBody("а".repeat(30), 10)).toBe(`${"а".repeat(10)}…`);
  });
});

describe("chatPushPayload", () => {
  it("заголовок — автор, ссылка — доска проекта, метка — проект", () => {
    const payload = chatPushPayload({ authorName: "Дмитрий", body: "Проверь заявку", projectId: "p-1" });
    expect(payload).toEqual({
      title: "Дмитрий",
      body: "Проверь заявку",
      url: "/p-1/board",
      tag: "chat:p-1",
    });
  });

  it("сообщение без текста называет вложение", () => {
    const photo = chatPushPayload({ authorName: "Дмитрий", body: "   ", projectId: "p-1", hasAttachments: true });
    expect(photo.body).toBe("Фото или файл");
    const empty = chatPushPayload({ authorName: "Дмитрий", body: "", projectId: "p-1" });
    expect(empty.body).toBe("Новое сообщение");
  });

  it("у разных проектов разные метки — уведомления не схлопываются между ними", () => {
    const first = chatPushPayload({ authorName: "А", body: "x", projectId: "p-1" });
    const second = chatPushPayload({ authorName: "А", body: "x", projectId: "p-2" });
    expect(first.tag).not.toBe(second.tag);
  });
});

describe("testPushPayload", () => {
  it("ведёт в профиль, где включали уведомления", () => {
    expect(testPushPayload().url).toBe("/profile");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("декодирует base64url с паддингом", () => {
    // "hello" в base64url без добивки.
    expect([...urlBase64ToUint8Array("aGVsbG8")]).toEqual([104, 101, 108, 108, 111]);
  });

  it("понимает символы - и _ вместо + и /", () => {
    // 0xFB 0xFF в обычном base64 — "+/8", в base64url — "-_8".
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });
});
