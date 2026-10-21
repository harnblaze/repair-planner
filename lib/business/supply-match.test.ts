import { describe, expect, it } from "vitest";

import { filterMaterialOptions, matchScore, sameMaterialName, suggestItemId, unitsMatch } from "./supply-match";

// Позиции из заявки «ТМЦ октябрь 2026 (кабмех)».
const items = [
  { id: "1", lineNo: 1, name: "Саморезы по дереву 51мм", cancelled: false },
  { id: "3", lineNo: 3, name: "Саморезы по дереву 35мм", cancelled: false },
  { id: "4", lineNo: 4, name: "Линолеум коммерческий Centra Botticelli T93 3.5м", cancelled: false },
  { id: "5", lineNo: 5, name: "Линолеум коммерческий Centra Botticelli T93 4м", cancelled: false },
  { id: "15", lineNo: 15, name: "Подвес прямой", cancelled: false },
  {
    id: "24",
    lineNo: 24,
    name: "Профиль внешний угол Alprofi ПК 03-9.2700.042л 270 см алюминий анодированный цвет шампань",
    cancelled: false,
  },
];

describe("suggestItemId", () => {
  it.each([
    ["Саморез по дереву 3,8х35 (1000шт) в ведре", "3"],
    ["Саморез по дереву 3,8х51 (500шт) в ведре", "1"],
    ["Линолеум коммерческий Centra Botticelli Т93 3.5м", "4"], // кириллическая «Т»
    ["Линолеум коммерческий Centra Botticelli Т93 4м", "5"],
    ["Профиль внешний угол Alprofі ПК 02.2700.15 270 см алюминий окрашенный цвет черный", "24"],
    ["Подвес прямой 60х27 0,7 мм", "15"],
  ])("%s → №%s", (lineName, expected) => {
    expect(suggestItemId(lineName, items)).toBe(expected);
  });

  it("leaves an off-request line unmatched", () => {
    expect(suggestItemId("Гвозди строительные 4,0х120 (25кг)", items)).toBeNull();
  });

  it("never suggests a cancelled item", () => {
    const withCancelled = items.map((i) => (i.id === "3" ? { ...i, cancelled: true } : i));
    expect(suggestItemId("Саморез по дереву 3,8х35 (1000шт) в ведре", withCancelled)).toBe("1");
  });
});

describe("matchScore", () => {
  it("is 1 when every item word is in the line", () => {
    expect(matchScore("Подвес прямой", "Подвес прямой 60х27 0,7 мм")).toBe(1);
  });

  it("is 0 for an empty item name", () => {
    expect(matchScore("", "Подвес")).toBe(0);
  });
});

describe("unitsMatch", () => {
  it.each([
    ["шт", "Шт."],
    [" м2 ", "м²"],
    ["пог. м", "пог.м"],
  ])("%j = %j", (a, b) => {
    expect(unitsMatch(a, b)).toBe(true);
  });

  it("tells упак from шт", () => {
    expect(unitsMatch("упак", "шт")).toBe(false);
  });
});

describe("case-insensitive matching", () => {
  it.each([
    ["Кабель ВВГ", "кабель ввг"],
    ["Труба профильная 40х20", "ТРУБА ПРОФИЛЬНАЯ 40Х20"],
    ["Электроды МР-3", "ЭЛЕКТРОДЫ МР-3"],
  ])("%s ~ %s → 1", (item, line) => {
    expect(matchScore(item, line)).toBe(1);
  });
});

describe("filterMaterialOptions", () => {
  const materials = [
    { id: "m1", name: "Саморез по дереву 3,8х51", unit: "шт" },
    { id: "m2", name: "Ёрш сантехнический", unit: "шт" },
    { id: "m3", name: "Линолеум Centra", unit: "м2" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterMaterialOptions(materials, "  ", null)).toEqual(materials);
  });

  it("matches every word of the query anywhere in the name, ignoring case and ё", () => {
    expect(filterMaterialOptions(materials, "дерев САМОРЕЗ", null).map((m) => m.id)).toEqual(["m1"]);
    expect(filterMaterialOptions(materials, "ерш", null).map((m) => m.id)).toEqual(["m2"]);
  });

  it("keeps the selected material visible even when it does not match", () => {
    expect(filterMaterialOptions(materials, "линолеум", "m2").map((m) => m.id)).toEqual(["m2", "m3"]);
  });
});

describe("sameMaterialName", () => {
  it("compares names like the unique index of materials: trimmed, case-insensitive", () => {
    expect(sameMaterialName(" Болт М12 ", "болт м12")).toBe(true);
    expect(sameMaterialName("Болт М12", "Болт М10")).toBe(false);
  });
});
