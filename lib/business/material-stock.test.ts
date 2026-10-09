import { describe, expect, it } from "vitest";

import { balanceState, countNeedingRestock, filterMaterials } from "./material-stock";

const material = (name: string, current_balance: number, minimum_balance: number) => ({
  name,
  current_balance,
  minimum_balance,
});

describe("balanceState", () => {
  it("is negative below zero", () => {
    expect(balanceState(-0.5, 2)).toBe("negative");
  });

  it("is low at the minimum, not only below it", () => {
    expect(balanceState(2, 2)).toBe("low");
    expect(balanceState(1, 2)).toBe("low");
  });

  it("is low at zero even when the minimum is zero", () => {
    expect(balanceState(0, 0)).toBe("low");
  });

  it("is ok above the minimum", () => {
    expect(balanceState(2.001, 2)).toBe("ok");
  });
});

describe("filterMaterials", () => {
  const materials = [
    material("Болт М12", 140, 50),
    material("Краска ПФ-115", -2, 1),
    material("Круг отрезной", 3, 10),
    material("Электроды МР-3", 12, 5),
  ];

  it("returns everything for an empty query without the restock filter", () => {
    expect(filterMaterials(materials, { query: "  ", onlyRestock: false })).toEqual(materials);
  });

  it("matches a name substring ignoring case and surrounding spaces", () => {
    expect(filterMaterials(materials, { query: " кра ", onlyRestock: false }).map((m) => m.name)).toEqual([
      "Краска ПФ-115",
    ]);
  });

  it("keeps only low and negative balances with the restock filter", () => {
    expect(filterMaterials(materials, { query: "", onlyRestock: true }).map((m) => m.name)).toEqual([
      "Краска ПФ-115",
      "Круг отрезной",
    ]);
  });

  it("combines the query with the restock filter", () => {
    expect(filterMaterials(materials, { query: "круг", onlyRestock: true }).map((m) => m.name)).toEqual([
      "Круг отрезной",
    ]);
    expect(filterMaterials(materials, { query: "болт", onlyRestock: true })).toEqual([]);
  });
});

describe("countNeedingRestock", () => {
  it("counts low and negative balances", () => {
    expect(countNeedingRestock([material("a", 5, 5), material("b", -1, 0), material("c", 6, 5)])).toBe(2);
  });
});
