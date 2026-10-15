import { describe, expect, it } from "vitest";

import { patchTask, toggleExecutor } from "./task-updates";

const ivanov = { id: "e1", name: "Иванов Иван" };
const petrov = { id: "e2", name: "Петров Пётр" };
const sidorov = { id: "e3", name: "Сидоров Сидор" };

describe("toggleExecutor", () => {
  it("adds an executor keeping the list sorted by name", () => {
    expect(toggleExecutor([ivanov, sidorov], petrov, true)).toEqual([ivanov, petrov, sidorov]);
  });

  it("removes an executor", () => {
    expect(toggleExecutor([ivanov, petrov], ivanov, false)).toEqual([petrov]);
  });

  it("does not duplicate an executor that is already assigned", () => {
    expect(toggleExecutor([ivanov], ivanov, true)).toEqual([ivanov]);
  });

  it("ignores removing an executor that is not assigned", () => {
    expect(toggleExecutor([ivanov], petrov, false)).toEqual([ivanov]);
  });
});

describe("patchTask", () => {
  type T = { id: string; status: string };
  const state = {
    days: {
      "2026-10-13": [{ id: "a", status: "planned" }, { id: "b", status: "planned" }] as T[],
      "2026-10-14": [{ id: "a", status: "planned" }] as T[],
    },
    queues: { main: [{ id: "c", status: "new" }] as T[] },
  };

  it("updates every card of the task across days and keeps other tasks", () => {
    const next = patchTask(state, "a", (t) => ({ ...t, status: "in_progress" }));
    expect(next.days["2026-10-13"]).toEqual([
      { id: "a", status: "in_progress" },
      { id: "b", status: "planned" },
    ]);
    expect(next.days["2026-10-14"]).toEqual([{ id: "a", status: "in_progress" }]);
    expect(next.queues).toBe(state.queues);
  });

  it("updates a task in a queue panel", () => {
    const next = patchTask(state, "c", (t) => ({ ...t, status: "paused" }));
    expect(next.queues.main).toEqual([{ id: "c", status: "paused" }]);
  });

  it("returns the same state when the task is not on the board", () => {
    expect(patchTask(state, "zzz", (t) => ({ ...t, status: "paused" }))).toBe(state);
  });
});
