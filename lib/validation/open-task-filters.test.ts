import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPEN_TASK_FILTERS,
  hasOpenTaskFilters,
  openTasksQuery,
  parseOpenTaskFilters,
} from "./open-task-filters";

const CAT = "3f0c8a52-7d4b-4e7a-9c1e-5b2d6f8a9e10";

describe("parseOpenTaskFilters", () => {
  it("без параметров — значения по умолчанию", () => {
    expect(parseOpenTaskFilters({})).toEqual(DEFAULT_OPEN_TASK_FILTERS);
  });

  it("разбирает текст и цех", () => {
    expect(parseOpenTaskFilters({ q: " насос ", category: CAT })).toEqual({ q: "насос", category: CAT });
  });

  it("неверный цех сбрасывается, текст остаётся", () => {
    expect(parseOpenTaskFilters({ q: "ворота", category: "abc" })).toEqual({ q: "ворота", category: null });
  });

  it("длинный текст обрезается до 100 символов", () => {
    expect(parseOpenTaskFilters({ q: "я".repeat(150) }).q).toHaveLength(100);
  });
});

describe("openTasksQuery", () => {
  it("по умолчанию — пустая строка", () => {
    expect(openTasksQuery(DEFAULT_OPEN_TASK_FILTERS)).toBe("");
  });

  it("разбор собранной строки возвращает те же фильтры", () => {
    const filters = { q: "насос, (ремонт)", category: CAT };
    const params = Object.fromEntries(new URLSearchParams(openTasksQuery(filters)));
    expect(parseOpenTaskFilters(params)).toEqual(filters);
  });
});

describe("hasOpenTaskFilters", () => {
  it("задан ли фильтр", () => {
    expect(hasOpenTaskFilters(DEFAULT_OPEN_TASK_FILTERS)).toBe(false);
    expect(hasOpenTaskFilters({ q: "насос", category: null })).toBe(true);
    expect(hasOpenTaskFilters({ q: "", category: CAT })).toBe(true);
  });
});
