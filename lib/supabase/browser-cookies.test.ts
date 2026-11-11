import { afterEach, describe, expect, it, vi } from "vitest";

import { browserCookies, parseCookieHeader, serializeCookie } from "./browser-cookies";
import { SESSION_MAX_AGE_SECONDS } from "./cookie-options";

describe("serializeCookie", () => {
  it("пишет атрибуты в формате cookie.parse", () => {
    expect(serializeCookie("sb-auth", "token", { maxAge: 10, path: "/", sameSite: "lax", secure: true })).toBe(
      "sb-auth=token; Max-Age=10; Path=/; SameSite=Lax; Secure",
    );
  });

  it("кодирует значение с JSON-спецсимволами", () => {
    // Сессия Supabase — JSON, и браузер обязан прочитать её обратно целиком.
    expect(serializeCookie("sb-auth", '{"a":1}', { path: "/" })).toBe("sb-auth=%7B%22a%22%3A1%7D; Path=/");
  });

  it("удаляет cookie через Max-Age=0", () => {
    expect(serializeCookie("sb-auth", "", { maxAge: 0, path: "/" })).toBe("sb-auth=; Max-Age=0; Path=/");
  });

  it("не ставит Secure в разработке", () => {
    expect(serializeCookie("sb-auth", "v", { path: "/", secure: false })).toBe("sb-auth=v; Path=/");
  });
});

describe("parseCookieHeader", () => {
  it("разбирает несколько cookie и раскодирует значения", () => {
    expect(parseCookieHeader("sb-auth=%7B%22a%22%3A1%7D; theme=dark")).toEqual([
      { name: "sb-auth", value: '{"a":1}' },
      { name: "theme", value: "dark" },
    ]);
  });

  it("не падает на пустом заголовке", () => {
    expect(parseCookieHeader("")).toEqual([]);
  });

  it("переживает битое процентное кодирование", () => {
    expect(parseCookieHeader("broken=%E0%A4%A")).toEqual([{ name: "broken", value: "%E0%A4%A" }]);
  });

  it("держит maxAge сессии тем же, что и серверные записи", () => {
    // Регрессия: встроенный браузерный адаптер писал 400 дней, и обновление
    // токена в открытой вкладке отменяло сокращение срока на сервере.
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });
});

describe("browserCookies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Поддельный document.cookie: хранит записанные строки целиком, как браузер. */
  function stubDocument() {
    const raw: string[] = [];
    vi.stubGlobal("document", {
      get cookie() {
        return raw.map((value) => value.split(";")[0]).join("; ");
      },
      set cookie(value: string) {
        raw.push(value);
      },
    });
    return raw;
  }

  it("пишет и читает сессию круговым обходом", () => {
    const raw = stubDocument();

    browserCookies.setAll([{ name: "sb-auth", value: '{"a":1}', options: { path: "/" } }]);

    // maxAge не передан — адаптер сам ставит срок сессии (см. cookie-options.ts).
    expect(raw[0]).toBe(`sb-auth=%7B%22a%22%3A1%7D; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/`);
    expect(browserCookies.getAll()).toEqual([{ name: "sb-auth", value: '{"a":1}' }]);
  });

  it("ставит срок сессии, а не 400 дней от @supabase/ssr", () => {
    const raw = stubDocument();

    browserCookies.setAll([{ name: "sb-auth", value: "v", options: { path: "/", maxAge: 400 * 24 * 60 * 60 } }]);

    expect(raw[0]).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(raw[0]).not.toContain("Max-Age=34560000");
  });

  it("ничего не делает без document (серверный рендер)", () => {
    vi.stubGlobal("document", undefined);

    expect(browserCookies.getAll()).toEqual([]);
    expect(() => browserCookies.setAll([{ name: "sb-auth", value: "v", options: {} }])).not.toThrow();
  });
});
