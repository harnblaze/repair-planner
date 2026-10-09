import { describe, expect, it } from "vitest";

import { formatDateNumeric, formatDateTime, formatDateWithWeekday } from "./dates";

describe("formatDateTime", () => {
  it("formats the moment in the project timezone, not the runtime one", () => {
    // 21:30 UTC 31 марта — это уже 1 апреля в Москве (UTC+3).
    expect(formatDateTime("2026-03-31T21:30:00+00:00", "Europe/Moscow")).toBe("1 апреля 2026, 00:30");
    expect(formatDateTime("2026-03-31T21:30:00+00:00", "UTC")).toBe("31 марта 2026, 21:30");
  });

  it("handles the new year boundary", () => {
    expect(formatDateTime("2025-12-31T22:05:00Z", "Asia/Yekaterinburg")).toBe("1 января 2026, 03:05");
  });
});

describe("formatDateNumeric", () => {
  it("formats the date of the moment in the project timezone", () => {
    // 22:00 UTC 30 сентября — уже 1 октября в Москве.
    expect(formatDateNumeric("2026-09-30T22:00:00+00:00", "Europe/Moscow")).toBe("01.10.2026");
    expect(formatDateNumeric("2026-09-30T22:00:00+00:00", "UTC")).toBe("30.09.2026");
  });
});

describe("formatDateWithWeekday", () => {
  it("names the weekday and abbreviates the month", () => {
    expect(formatDateWithWeekday("2026-10-12")).toBe("пн, 12 окт.");
  });

  it("keeps short month names whole and drops the leading zero of the day", () => {
    expect(formatDateWithWeekday("2026-05-01")).toBe("пт, 1 мая");
  });

  it("does not depend on the server timezone near midnight UTC", () => {
    expect(formatDateWithWeekday("2026-01-04")).toBe("вс, 4 янв.");
  });
});
