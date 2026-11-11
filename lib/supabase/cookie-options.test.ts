import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_SECONDS, withSessionMaxAge } from "./cookie-options";

describe("withSessionMaxAge", () => {
  it("сокращает срок жизни сессии до 30 дней", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(withSessionMaxAge({ path: "/", sameSite: "lax" })).toEqual({
      path: "/",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  });

  it("оставляет удаление cookie немедленным", () => {
    // maxAge: 0 ставит @supabase/ssr при выходе: если переписать его на 30
    // дней, выход перестанет работать.
    expect(withSessionMaxAge({ maxAge: 0 })).toEqual({ maxAge: 0 });
  });

  it("сохраняет secure, path и domain", () => {
    expect(withSessionMaxAge({ secure: true, path: "/", domain: "example.test", maxAge: 400 })).toEqual({
      secure: true,
      path: "/",
      domain: "example.test",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  });

  it("не мутирует исходные опции", () => {
    const options = { path: "/" };
    withSessionMaxAge(options);
    expect(options).toEqual({ path: "/" });
  });
});
