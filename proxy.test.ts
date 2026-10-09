import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config } from "./proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("proxy matcher", () => {
  // Иначе без сессии эти файлы отдают редирект на /login: браузер не сможет
  // установить приложение, а сервис-воркер — закешировать экран «Нет сети».
  it.each(["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png"])(
    "skips the PWA file %s",
    (url) => {
      expect(matches(url)).toBe(false);
    },
  );

  it.each(["/", "/projects", "/login", "/abc/tasks/def"])("still guards the page %s", (url) => {
    expect(matches(url)).toBe(true);
  });
});
