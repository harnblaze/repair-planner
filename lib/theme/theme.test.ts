import { describe, expect, it } from "vitest";

import {
  THEME_COLORS,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeChoice,
  resolveTheme,
  themeLabel,
  toggleTheme,
} from "./theme";

describe("parseThemeChoice", () => {
  it("по умолчанию — как в системе", () => {
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("system")).toBe("system");
    expect(parseThemeChoice("тёмная")).toBe("system");
  });

  it("явный выбор запоминается", () => {
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("light")).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("явный выбор не зависит от системы", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("системная тема следует за настройкой устройства", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("toggleTheme", () => {
  it("переключает то, что видно сейчас", () => {
    expect(toggleTheme("system", true)).toBe("light");
    expect(toggleTheme("system", false)).toBe("dark");
    expect(toggleTheme("dark", true)).toBe("light");
    expect(toggleTheme("light", true)).toBe("dark");
  });
});

describe("оформление", () => {
  it("подписи для выбора темы", () => {
    expect(themeLabel("light")).toBe("Светлая");
    expect(themeLabel("dark")).toBe("Тёмная");
    expect(themeLabel("system")).toBe("Как в системе");
  });

  it("ключ и цвет строки состояния стабильны", () => {
    expect(THEME_STORAGE_KEY).toBe("theme");
    expect(THEME_COLORS.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLORS.light).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("скрипт темы читает то же хранилище и ставит класс", () => {
    expect(THEME_SCRIPT).toContain(`localStorage.getItem("theme")`);
    expect(THEME_SCRIPT).toContain(`classList.toggle("dark"`);
  });
});
