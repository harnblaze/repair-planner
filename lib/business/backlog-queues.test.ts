import { describe, expect, it } from "vitest";

import {
  MAIN_QUEUE_KEY,
  moveTaskBetweenQueues,
  queueDropIndex,
  queueIdOf,
  queueKey,
} from "./backlog-queues";

type T = { id: string; queueId: string | null };
const task = (id: string, queueId: string | null = null): T => ({ id, queueId });
const ids = (list: T[] | undefined) => (list ?? []).map((t) => t.id);

describe("queueKey / queueIdOf", () => {
  it("основная очередь — ключ main и обратно null", () => {
    expect(queueKey(null)).toBe(MAIN_QUEUE_KEY);
    expect(queueIdOf(MAIN_QUEUE_KEY)).toBeNull();
  });

  it("дополнительная очередь — ключ равен id", () => {
    expect(queueKey("q1")).toBe("q1");
    expect(queueIdOf("q1")).toBe("q1");
  });
});

describe("moveTaskBetweenQueues", () => {
  const main = [task("a"), task("b"), task("c")];

  it("внутри очереди: индекс — место без перемещаемой заявки", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "c", "main", "main", 0).main)).toEqual(["c", "a", "b"]);
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "main", 2).main)).toEqual(["b", "c", "a"]);
  });

  it("в другую очередь: убирает из исходной, вставляет в целевую и меняет queueId", () => {
    const result = moveTaskBetweenQueues({ main, q1: [task("x", "q1")] }, "a", "main", "q1", 0);
    expect(ids(result.main)).toEqual(["b", "c"]);
    expect(ids(result.q1)).toEqual(["a", "x"]);
    expect(result.q1[0].queueId).toBe("q1");
  });

  it("в основную очередь — queueId становится null", () => {
    const result = moveTaskBetweenQueues({ main, q1: [task("x", "q1")] }, "x", "q1", "main", 1);
    expect(ids(result.main)).toEqual(["a", "x", "b", "c"]);
    expect(result.main[1].queueId).toBeNull();
    expect(ids(result.q1)).toEqual([]);
  });

  it("в пустую очередь, которой ещё нет в состоянии", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "q2", 0).q2)).toEqual(["a"]);
  });

  it("зажимает индекс в границы списка", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "main", 99).main)).toEqual(["b", "c", "a"]);
    expect(ids(moveTaskBetweenQueues({ main }, "c", "main", "main", -3).main)).toEqual(["c", "a", "b"]);
  });

  it("неизвестная заявка — состояние не меняется", () => {
    const queues = { main };
    expect(moveTaskBetweenQueues(queues, "zzz", "main", "main", 0)).toBe(queues);
  });
});

describe("queueDropIndex", () => {
  const list = [task("a"), task("b"), task("c")];

  it("своя панель, курсор над строкой — индекс этой строки", () => {
    expect(queueDropIndex(list, "a", "c", false)).toBe(2);
    expect(queueDropIndex(list, "c", "a", true)).toBe(0);
  });

  it("своя панель: верхняя половина панели (заголовок, форма) — наверх, нижняя — в конец", () => {
    expect(queueDropIndex(list, "c", null, false)).toBe(0);
    expect(queueDropIndex(list, "a", null, true)).toBe(2);
  });

  it("чужая панель — перед строкой или после неё", () => {
    expect(queueDropIndex(list, "x", "b", false)).toBe(1);
    expect(queueDropIndex(list, "x", "b", true)).toBe(2);
  });

  it("чужая панель: верхняя половина панели — наверх, нижняя — в конец; пустая — 0", () => {
    expect(queueDropIndex(list, "x", null, false)).toBe(0);
    expect(queueDropIndex(list, "x", null, true)).toBe(3);
    expect(queueDropIndex([], "x", null, true)).toBe(0);
  });
});
