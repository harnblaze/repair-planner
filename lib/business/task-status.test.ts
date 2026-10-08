import { describe, expect, it } from "vitest";

import { closedTimestamps } from "./task-status";

const NOW = new Date("2026-10-08T14:00:00.000Z");

describe("closedTimestamps", () => {
  it("завершена — дата выполнения", () => {
    expect(closedTimestamps("completed", NOW)).toEqual({ completed_at: NOW.toISOString(), cancelled_at: null });
  });

  it("отменена — дата отмены", () => {
    expect(closedTimestamps("cancelled", NOW)).toEqual({ completed_at: null, cancelled_at: NOW.toISOString() });
  });

  it("открытый статус сбрасывает обе даты", () => {
    for (const status of ["new", "planned", "in_progress", "paused"] as const) {
      expect(closedTimestamps(status, NOW)).toEqual({ completed_at: null, cancelled_at: null });
    }
  });
});
