import { describe, expect, it } from "vitest";

import { formatDateTime } from "./dates";

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
