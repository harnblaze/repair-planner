import { describe, expect, it } from "vitest";

import { DONE_STACK_MIN, isDoneOnDay, splitDayTasks } from "./day-stack";

import type { TaskStatus } from "@/lib/business/task-status";

type T = { id: string; status: TaskStatus; isHistory?: boolean };
const t = (id: string, status: TaskStatus, isHistory?: boolean): T => ({ id, status, isHistory });
const ids = (list: T[]) => list.map((x) => x.id);

describe("isDoneOnDay", () => {
  it("treats completed and cancelled as done", () => {
    expect(isDoneOnDay(t("a", "completed"))).toBe(true);
    expect(isDoneOnDay(t("a", "cancelled"))).toBe(true);
  });

  it("treats unfinished statuses as not done", () => {
    for (const s of ["new", "planned", "in_progress", "paused"] as const) {
      expect(isDoneOnDay(t("a", s))).toBe(false);
    }
  });

  it("never treats a history card as done", () => {
    expect(isDoneOnDay(t("a", "completed", true))).toBe(false);
    expect(isDoneOnDay(t("a", "cancelled", true))).toBe(false);
  });
});

describe("splitDayTasks", () => {
  it("returns empty groups for an empty day", () => {
    expect(splitDayTasks<T>([])).toEqual({ active: [], done: [], stacked: false });
  });

  it("keeps relative order inside both groups", () => {
    const r = splitDayTasks([
      t("1", "completed"),
      t("2", "planned"),
      t("3", "cancelled"),
      t("4", "in_progress"),
      t("5", "completed", true),
    ]);
    expect(ids(r.active)).toEqual(["2", "4", "5"]);
    expect(ids(r.done)).toEqual(["1", "3"]);
  });

  it("stacks only from DONE_STACK_MIN done cards", () => {
    expect(DONE_STACK_MIN).toBe(2);
    expect(splitDayTasks([t("1", "planned")]).stacked).toBe(false);
    expect(splitDayTasks([t("1", "completed")]).stacked).toBe(false);
    expect(splitDayTasks([t("1", "completed"), t("2", "cancelled")]).stacked).toBe(true);
  });

  it("does not count history cards towards the stack", () => {
    expect(splitDayTasks([t("1", "completed"), t("2", "completed", true)]).stacked).toBe(false);
  });
});
