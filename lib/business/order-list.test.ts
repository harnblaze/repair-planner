import { describe, expect, it } from "vitest";

import { isMaterialInOrder, isOrderList, orderItemTitle, suggestedOrderQuantity } from "./order-list";
import { parseOrderItem } from "./omts-request";

describe("isOrderList", () => {
  it("узнаёт системный список материалов", () => {
    expect(isOrderList("Материалы к заказу", true)).toBe(true);
  });
  it("не принимает пользовательский список", () => {
    expect(isOrderList("Материалы для отчёта", false)).toBe(false);
  });
  it("не принимает другие системные списки", () => {
    expect(isOrderList("Напоминания", true)).toBe(false);
  });
});

describe("orderItemTitle", () => {
  it("собирает «название - кол-во ед.»", () => {
    expect(orderItemTitle("Электроды МР-3", 20, "кг")).toBe("Электроды МР-3 - 20 кг");
    expect(orderItemTitle("Краска", 2.5, "л")).toBe("Краска - 2,5 л");
  });
  it("обрезает пробелы", () => {
    expect(orderItemTitle("  Краска ", 1, " л ")).toBe("Краска - 1 л");
  });
  it("разбирается обратно parseOrderItem", () => {
    for (const [name, quantity, unit] of [
      ["Электроды МР-3", 20, "кг"],
      ["Краска", 2.5, "л"],
    ] as const) {
      const row = parseOrderItem(orderItemTitle(name, quantity, unit), null);
      expect(row).toMatchObject({ name, quantity, unit, parsed: true });
    }
  });
});

describe("isMaterialInOrder", () => {
  it("находит по названию без учёта регистра", () => {
    expect(isMaterialInOrder("электроды мр-3", ["Электроды МР-3 - 20 кг"])).toBe(true);
  });
  it("находит пункт без количества", () => {
    expect(isMaterialInOrder("Электроды МР-3", ["Электроды МР-3"])).toBe(true);
  });
  it("не путает составной пункт", () => {
    expect(isMaterialInOrder("Электроды МР-3", ["Электроды МР-3 и МР-4 - 5 кг"])).toBe(false);
  });
  it("пустой список — false", () => {
    expect(isMaterialInOrder("Краска", [])).toBe(false);
  });
});

describe("suggestedOrderQuantity", () => {
  it("считает недостающее до минимума", () => {
    expect(suggestedOrderQuantity(2, 5)).toBe(3);
    expect(suggestedOrderQuantity(-2, 0)).toBe(2);
    expect(suggestedOrderQuantity(1.25, 2)).toBe(0.75);
  });
  it("0 — null", () => {
    expect(suggestedOrderQuantity(0, 0)).toBeNull();
    expect(suggestedOrderQuantity(5, 2)).toBeNull();
  });
});
