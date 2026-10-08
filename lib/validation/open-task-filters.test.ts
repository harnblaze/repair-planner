import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPEN_TASK_FILTERS,
  MAIN_QUEUE,
  hasOpenTaskFilters,
  openTasksQuery,
  parseOpenTaskFilters,
} from "./open-task-filters";

const CAT = "3f0c8a52-7d4b-4e7a-9c1e-5b2d6f8a9e10";
const EXEC = "7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const QUEUE = "d1000000-0000-4000-8000-00000000000a";

describe("parseOpenTaskFilters", () => {
  it("без параметров — значения по умолчанию", () => {
    expect(parseOpenTaskFilters({})).toEqual(DEFAULT_OPEN_TASK_FILTERS);
  });

  it("разбирает текст и цех", () => {
    expect(parseOpenTaskFilters({ q: " насос ", category: CAT })).toEqual({
      ...DEFAULT_OPEN_TASK_FILTERS,
      q: "насос",
      category: CAT,
    });
  });

  it("неверный цех сбрасывается, текст остаётся", () => {
    expect(parseOpenTaskFilters({ q: "ворота", category: "abc" })).toEqual({
      ...DEFAULT_OPEN_TASK_FILTERS,
      q: "ворота",
    });
  });

  it("длинный текст обрезается до 100 символов", () => {
    expect(parseOpenTaskFilters({ q: "я".repeat(150) }).q).toHaveLength(100);
  });

  it("разбирает исполнителя, открытый статус и очередь", () => {
    expect(parseOpenTaskFilters({ executor: EXEC, status: "paused", queue: QUEUE })).toEqual({
      ...DEFAULT_OPEN_TASK_FILTERS,
      executor: EXEC,
      status: "paused",
      queue: QUEUE,
    });
  });

  it("основная очередь «Текущие заявки» — main", () => {
    expect(parseOpenTaskFilters({ queue: MAIN_QUEUE }).queue).toBe(MAIN_QUEUE);
  });

  it("закрытый или неизвестный статус, неверные исполнитель и очередь сбрасываются", () => {
    expect(parseOpenTaskFilters({ status: "completed" }).status).toBeNull();
    expect(parseOpenTaskFilters({ status: "done" }).status).toBeNull();
    expect(parseOpenTaskFilters({ executor: "abc" }).executor).toBeNull();
    expect(parseOpenTaskFilters({ queue: "Main" }).queue).toBeNull();
  });
});

describe("openTasksQuery", () => {
  it("по умолчанию — пустая строка", () => {
    expect(openTasksQuery(DEFAULT_OPEN_TASK_FILTERS)).toBe("");
  });

  it("разбор собранной строки возвращает те же фильтры", () => {
    const filters = { q: "насос, (ремонт)", category: CAT, executor: EXEC, status: "new" as const, queue: MAIN_QUEUE };
    const params = Object.fromEntries(new URLSearchParams(openTasksQuery(filters)));
    expect(parseOpenTaskFilters(params)).toEqual(filters);
  });
});

describe("hasOpenTaskFilters", () => {
  it("задан ли фильтр", () => {
    expect(hasOpenTaskFilters(DEFAULT_OPEN_TASK_FILTERS)).toBe(false);
    expect(hasOpenTaskFilters({ ...DEFAULT_OPEN_TASK_FILTERS, q: "насос" })).toBe(true);
    expect(hasOpenTaskFilters({ ...DEFAULT_OPEN_TASK_FILTERS, category: CAT })).toBe(true);
    expect(hasOpenTaskFilters({ ...DEFAULT_OPEN_TASK_FILTERS, executor: EXEC })).toBe(true);
    expect(hasOpenTaskFilters({ ...DEFAULT_OPEN_TASK_FILTERS, status: "in_progress" })).toBe(true);
    expect(hasOpenTaskFilters({ ...DEFAULT_OPEN_TASK_FILTERS, queue: QUEUE })).toBe(true);
  });
});
