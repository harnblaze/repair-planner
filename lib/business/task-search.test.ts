import { describe, expect, it } from "vitest";

import { matchesTaskText } from "./task-search";

const task = { title: "Ремонт НАСОСА", description: "Замена сальника, (срочно)" };

describe("matchesTaskText", () => {
  it("пустой запрос — подходит любая заявка", () => {
    expect(matchesTaskText(task, "")).toBe(true);
  });

  it("ищет в названии без учёта регистра", () => {
    expect(matchesTaskText(task, "насос")).toBe(true);
  });

  it("ищет в описании, запятые и скобки — обычный текст", () => {
    expect(matchesTaskText(task, "сальника, (срочно)")).toBe(true);
  });

  it("нет совпадения", () => {
    expect(matchesTaskText(task, "ворота")).toBe(false);
  });

  it("описания нет", () => {
    expect(matchesTaskText({ title: "Сварка", description: null }, "сальник")).toBe(false);
  });
});
