import { describe, expect, it } from "vitest";

import { moveTaskQueueSchema, taskQueueSchema } from "./task-queue";

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

describe("moveTaskQueueSchema", () => {
  const queueId = "d2000000-0000-4000-8000-000000000001";

  it("принимает id очереди и неотрицательную позицию", () => {
    expect(moveTaskQueueSchema.parse({ queueId, position: 0 })).toEqual({ queueId, position: 0 });
  });

  it("отклоняет неверный id, дробную и отрицательную позицию", () => {
    expect(moveTaskQueueSchema.safeParse({ queueId: "abc", position: 0 }).success).toBe(false);
    expect(moveTaskQueueSchema.safeParse({ queueId, position: 1.5 }).success).toBe(false);
    expect(moveTaskQueueSchema.safeParse({ queueId, position: -1 }).success).toBe(false);
  });
});
