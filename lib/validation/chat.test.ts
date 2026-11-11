import { describe, expect, it } from "vitest";

import { chatHistoryCursorSchema } from "./chat";

const MESSAGE_ID = "c3f1d0b2-8a44-4f1e-9a3b-2f6c1d7e5a90";

describe("chatHistoryCursorSchema", () => {
  it("принимает курсор из настоящего created_at", () => {
    // Именно так Postgres отдаёт timestamptz в PostgREST: T, микросекунды и
    // смещение +00:00. Этот же вид приходит из браузера.
    const cursor = { createdAt: "2026-11-11T12:00:00.123456+00:00", id: MESSAGE_ID };
    expect(chatHistoryCursorSchema.parse(cursor)).toEqual(cursor);
  });

  it("принимает Z и смещение со знаком", () => {
    expect(chatHistoryCursorSchema.safeParse({ createdAt: "2026-11-11T12:00:00Z", id: MESSAGE_ID }).success).toBe(
      true,
    );
    expect(chatHistoryCursorSchema.safeParse({ createdAt: "2026-11-11T12:00:00+03:00", id: MESSAGE_ID }).success).toBe(
      true,
    );
  });

  it("отклоняет попытку подменить фильтр PostgREST через время", () => {
    // Запятая и скобки закрыли бы `or(…)` и позволили бы дописать своё условие.
    for (const createdAt of [
      "2026-11-11T12:00:00Z,and(or(id.neq.null))",
      "2026-01-01T00:00:00Z,id.lt.0",
      "2026-11-11T12:00:00Z)",
      "(2026-11-11T12:00:00Z",
    ]) {
      expect(chatHistoryCursorSchema.safeParse({ createdAt, id: MESSAGE_ID }).success).toBe(false);
    }
  });

  it("отклоняет пустое время, дату без времени и мусор", () => {
    for (const createdAt of ["", "2026-11-11", "вчера", "2026-13-45T99:99:99Z"]) {
      expect(chatHistoryCursorSchema.safeParse({ createdAt, id: MESSAGE_ID }).success).toBe(false);
    }
  });

  it("отклоняет не-uuid вместо id", () => {
    for (const id of ["", "not-a-uuid", "1", "c3f1d0b2-8a44-4f1e-9a3b-2f6c1d7e5a9"]) {
      expect(chatHistoryCursorSchema.safeParse({ createdAt: "2026-11-11T12:00:00Z", id }).success).toBe(false);
    }
  });
});
