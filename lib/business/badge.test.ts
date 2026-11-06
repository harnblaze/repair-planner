import { describe, expect, it } from "vitest";

import { badgeLabel, faviconLabel, stripBadge, titleWithBadge } from "./badge";

describe("badgeLabel", () => {
  it("ноль и отрицательные не показываются", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(-3)).toBe("");
    expect(badgeLabel(Number.NaN)).toBe("");
  });

  it("до 99 — как есть, дальше «99+»", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});

describe("titleWithBadge", () => {
  it("добавляет число перед заголовком", () => {
    expect(titleWithBadge("Доска — Планировщик", 3)).toBe("(3) Доска — Планировщик");
  });

  it("не накапливает прежний счётчик", () => {
    expect(titleWithBadge("(1) Доска — Планировщик", 2)).toBe("(2) Доска — Планировщик");
  });

  it("при нуле возвращает чистый заголовок", () => {
    expect(titleWithBadge("(5) Доска — Планировщик", 0)).toBe("Доска — Планировщик");
  });
});

describe("stripBadge", () => {
  it("снимает только ведущий счётчик", () => {
    expect(stripBadge("(12) Чат")).toBe("Чат");
    expect(stripBadge("(99+) Чат")).toBe("Чат");
    expect(stripBadge("Чат (12)")).toBe("Чат (12)");
    expect(stripBadge("Чат")).toBe("Чат");
  });
});

describe("faviconLabel", () => {
  it("на иконке вкладки максимум две цифры", () => {
    expect(faviconLabel(0)).toBe("");
    expect(faviconLabel(7)).toBe("7");
    expect(faviconLabel(9)).toBe("9");
    expect(faviconLabel(10)).toBe("9+");
    expect(faviconLabel(120)).toBe("9+");
  });
});
