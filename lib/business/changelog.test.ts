import { describe, expect, it } from "vitest";

import {
  CHANGELOG,
  CHANGELOG_KIND_LABEL,
  formatChangelogDate,
  latestChangelogId,
  readSeenId,
  unseenChangelogCount,
  type ChangelogKind,
} from "./changelog";

const KINDS: ChangelogKind[] = ["new", "fix", "improve"];

describe("CHANGELOG", () => {
  it("идёт от новых записей к старым", () => {
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
  });

  it("не переиспользует id", () => {
    const ids = CHANGELOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("не оставляет записей без текста", () => {
    for (const entry of CHANGELOG) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.items.length).toBeGreaterThan(0);
      for (const item of entry.items) {
        expect(item.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("использует только известные типы пунктов", () => {
    for (const entry of CHANGELOG) {
      for (const item of entry.items) {
        expect(KINDS).toContain(item.kind);
        expect(CHANGELOG_KIND_LABEL[item.kind]).toBeTruthy();
      }
    }
  });
});

describe("latestChangelogId", () => {
  it("возвращает id первой записи списка", () => {
    expect(latestChangelogId()).toBe(CHANGELOG[0].id);
  });
});

describe("unseenChangelogCount", () => {
  it("без отметки считает все записи новыми", () => {
    expect(unseenChangelogCount(null)).toBe(CHANGELOG.length);
  });

  it("на самой свежей записи новых нет", () => {
    expect(unseenChangelogCount(latestChangelogId())).toBe(0);
  });

  it("считает только записи новее просмотренной", () => {
    // Вторая запись в списке: новее неё ровно одна (первая).
    expect(unseenChangelogCount(CHANGELOG[1].id)).toBe(1);
    expect(unseenChangelogCount(CHANGELOG[CHANGELOG.length - 1].id)).toBe(CHANGELOG.length - 1);
  });

  it("незнакомый id считает непросмотренным всё", () => {
    expect(unseenChangelogCount("2020-01-01-removed")).toBe(CHANGELOG.length);
  });
});

describe("readSeenId", () => {
  it("принимает только id из списка", () => {
    const id = latestChangelogId();
    expect(id).not.toBeNull();
    expect(readSeenId(id)).toBe(id);
    expect(readSeenId(`  ${id}  `)).toBe(id);
  });

  it("пустое, мусор и чужой id — это «не видел»", () => {
    expect(readSeenId(null)).toBeNull();
    expect(readSeenId("")).toBeNull();
    expect(readSeenId("   ")).toBeNull();
    expect(readSeenId("null")).toBeNull();
    expect(readSeenId("2020-01-01-removed")).toBeNull();
  });
});

describe("formatChangelogDate", () => {
  it("пишет дату по-русски с годом", () => {
    expect(formatChangelogDate("2026-11-03")).toBe("3 ноября 2026");
    expect(formatChangelogDate("2026-11-02")).toBe("2 ноября 2026");
  });
});
