import { describe, expect, it } from "vitest";

import { taskQueueSchema } from "./task-queue";

describe("taskQueueSchema", () => {
  it("обрезает пробелы", () => {
    expect(taskQueueSchema.parse({ name: "  Столярные дела  " })).toEqual({ name: "Столярные дела" });
  });

  it("отклоняет пустое имя и имя из пробелов", () => {
    expect(taskQueueSchema.safeParse({ name: "" }).success).toBe(false);
    expect(taskQueueSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("принимает 60 символов и отклоняет 61", () => {
    expect(taskQueueSchema.safeParse({ name: "я".repeat(60) }).success).toBe(true);
    expect(taskQueueSchema.safeParse({ name: "я".repeat(61) }).success).toBe(false);
  });
});
