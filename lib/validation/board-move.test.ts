import { describe, expect, it } from "vitest";

import { moveBacklogTaskSchema } from "./board-move";

const TASK = "f1000000-0000-0000-0000-000000000001";
const QUEUE = "d1000000-0000-0000-0000-00000000000a";

describe("moveBacklogTaskSchema", () => {
  it("принимает основную очередь (null)", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: null, position: 0 }).success).toBe(true);
  });

  it("принимает id очереди", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: QUEUE, position: 3 }).success).toBe(true);
  });

  it("отклоняет ключ вместо id очереди", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: "main", position: 0 }).success).toBe(false);
  });

  it("отклоняет отрицательную, дробную и слишком большую позицию", () => {
    for (const position of [-1, 1.5, 10_001]) {
      expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: null, position }).success).toBe(false);
    }
  });

  it("отклоняет не-uuid заявки", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: "1", queueId: null, position: 0 }).success).toBe(false);
  });
});
