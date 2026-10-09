import { describe, expect, it } from "vitest";

import { TASK_STATUSES } from "@/lib/business/task-status";

import { STATUS_CLASSES } from "./status-badge";

describe("STATUS_CLASSES", () => {
  it("gives every status its own colours so statuses are told apart at a glance", () => {
    const classes = TASK_STATUSES.map((s) => STATUS_CLASSES[s.value]);
    expect(new Set(classes).size).toBe(TASK_STATUSES.length);
  });
});
