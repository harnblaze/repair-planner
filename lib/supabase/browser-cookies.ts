import type { CookieOptions } from "@supabase/ssr";

import { withSessionMaxAge } from "@/lib/supabase/cookie-options";

/**
 * Cookie-хранилище для браузерного клиента Supabase.
 *
 * Зачем своё: встроенный `document.cookie`-адаптер `@supabase/ssr` пишет cookie
 * с `maxAge` из DEFAULT_COOKIE_OPTIONS (400 дней) и переопределить его через
 * `cookieOptions` нельзя — пакет подставляет константу уже после слияния
 * опций. Без этого адаптера обновление токена в открытой вкладке снова
 * продлевало бы сессию на 400 дней, обнуляя сокращение в серверных `setAll`.
 *
 * Свой сериализатор, а не `cookie`: пакет приходит транзитивно, а нужен ровно
 * один формат — тот, что читает `cookie.parse` (encodeURIComponent для имени и
 * значения).
 */
/** Битое процентное кодирование не должно ронять чтение сессии. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookieHeader(header: string): { name: string; value: string }[] {
  if (!header) return [];

  return header.split("; ").map((pair) => {
    const separator = pair.indexOf("=");
    if (separator < 0) return { name: pair, value: "" };
    return {
      name: pair.slice(0, separator),
      value: decode(pair.slice(separator + 1)),
    };
  });
}

function formatSameSite(sameSite: CookieOptions["sameSite"]): string | null {
  if (sameSite === true) return "Strict";
  if (!sameSite || typeof sameSite !== "string") return null;
  return sameSite.charAt(0).toUpperCase() + sameSite.slice(1);
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (typeof options.domain === "string") {
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`Path=${options.path ?? "/"}`);

  const sameSite = formatSameSite(options.sameSite);
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (options.secure) parts.push("Secure");

  return parts.join("; ");
}

export const browserCookies = {
  getAll() {
    // Клиент создаётся только в useEffect, но страховка дешёвая: вызов из
    // серверного рендера должен вернуть пусто, а не упасть на document.
    if (typeof document === "undefined") return [];
    return parseCookieHeader(document.cookie);
  },
  setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
    if (typeof document === "undefined") return;
    for (const { name, value, options } of cookiesToSet) {
      document.cookie = serializeCookie(name, value, withSessionMaxAge(options));
    }
  },
};
