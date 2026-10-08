import { describe, expect, it } from "vitest";

import { createTaskSchema } from "./task";

const QUEUE_ID = "3f0c8a52-7d4b-4e7a-9c1e-5b2d6f8a9e10";

describe("createTaskSchema.queueId", () => {
  it("пусто или не задано — основная очередь «Текущие заявки»", () => {
    expect(createTaskSchema.safeParse({ title: "Заявка" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "Заявка", queueId: "" }).success).toBe(true);
  });

  it("принимает идентификатор очереди", () => {
    expect(createTaskSchema.parse({ title: "Заявка", queueId: QUEUE_ID }).queueId).toBe(QUEUE_ID);
  });

  it("отклоняет строку, которая не является идентификатором", () => {
    expect(createTaskSchema.safeParse({ title: "Заявка", queueId: "столярка" }).success).toBe(false);
  });
});
