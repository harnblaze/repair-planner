import { describe, expect, it } from "vitest";

import {
  ACTIVITY_SEEN_WINDOW_DAYS,
  activitySeenKey,
  countSince,
  isNewer,
  parseSeenAt,
} from "./activity-seen";

describe("activitySeenKey", () => {
  it("свой ключ на каждый проект", () => {
    expect(activitySeenKey("p1")).toBe("activity:seen:p1");
    expect(activitySeenKey("p2")).not.toBe(activitySeenKey("p1"));
  });
});

describe("parseSeenAt", () => {
  it("пусто и отсутствие — метки нет", () => {
    expect(parseSeenAt(null)).toBeNull();
    expect(parseSeenAt(undefined)).toBeNull();
    expect(parseSeenAt("")).toBeNull();
    expect(parseSeenAt("   ")).toBeNull();
  });

  it("мусор не превращается в дату", () => {
    expect(parseSeenAt("null")).toBeNull();
    expect(parseSeenAt("вчера")).toBeNull();
    expect(parseSeenAt("2026-13-45")).toBeNull();
  });

  it("микросекунды сохраняются: иначе метка станет раньше записи", () => {
    // Так время приходит из Postgres; Date обрезал бы его до .467Z, и запись
    // в 17:11:42.467848 снова считалась бы новой.
    expect(parseSeenAt("2026-11-03T17:11:42.467848+00:00")).toBe("2026-11-03T17:11:42.467848Z");
    expect(parseSeenAt("2026-11-03T07:00:00.000Z")).toBe("2026-11-03T07:00:00.000Z");
  });

  it("смещение, отличное от UTC, остаётся как есть", () => {
    expect(parseSeenAt("2026-11-03T10:00:00+03:00")).toBe("2026-11-03T10:00:00+03:00");
  });
});

describe("isNewer", () => {
  it("без метки новое всё", () => {
    expect(isNewer("2026-11-03T07:00:00.000Z", null)).toBe(true);
  });

  it("строго позже — новое, ровно в метку — нет", () => {
    const seen = "2026-11-03T07:00:00.000Z";
    expect(isNewer("2026-11-03T07:00:01.000Z", seen)).toBe(true);
    expect(isNewer(seen, seen)).toBe(false);
    expect(isNewer("2026-11-03T06:59:59.000Z", seen)).toBe(false);
  });

  it("битая дата события новым не считается", () => {
    expect(isNewer("не дата", "2026-11-03T07:00:00.000Z")).toBe(false);
  });
});

describe("countSince", () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const windowStart = new Date(
    now.getTime() - ACTIVITY_SEEN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  it("без метки — окно 30 дней", () => {
    expect(countSince(null, now)).toBe(windowStart);
  });

  it("свежая метка важнее окна и не теряет точность", () => {
    expect(countSince("2026-11-01T10:00:00.000Z", now)).toBe("2026-11-01T10:00:00.000Z");
    expect(countSince("2026-11-03T17:11:42.467848Z", now)).toBe("2026-11-03T17:11:42.467848Z");
  });

  it("метка старше окна обрезается до окна", () => {
    expect(countSince("2020-01-01T00:00:00.000Z", now)).toBe(windowStart);
  });

  it("битая метка — тоже окно", () => {
    expect(countSince("мусор", now)).toBe(windowStart);
  });
});
