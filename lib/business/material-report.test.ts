import { describe, expect, it } from "vitest";

import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  addMonths,
  buildConsumptionCsv,
  filterGroups,
  formatMonthLabel,
  formatQuantity,
  groupByCategory,
  resolveMonth,
  type ConsumptionRow,
} from "./material-report";

const rows: ConsumptionRow[] = [
  { category_id: "c1", category_name: "Механический", material_id: "m1", material_name: "Электрод", unit: "кг", quantity: 2.5 },
  { category_id: "c1", category_name: "Механический", material_id: "m2", material_name: "Диск", unit: "шт", quantity: 3 },
  { category_id: null, category_name: null, material_id: "m1", material_name: "Электрод", unit: "кг", quantity: 1 },
];

describe("месяц отчёта", () => {
  it("берёт месяц из параметра, иначе — месяц сегодняшнего дня проекта", () => {
    expect(resolveMonth("2026-04", "2026-09-13")).toBe("2026-04");
    expect(resolveMonth(undefined, "2026-09-13")).toBe("2026-09");
    expect(resolveMonth("2026-13", "2026-09-13")).toBe("2026-09");
    expect(resolveMonth(["2026-04"], "2026-09-13")).toBe("2026-09");
  });

  it("переходит через границу года", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
  });

  it("подпись месяца", () => {
    expect(formatMonthLabel("2026-09")).toBe("Сентябрь 2026");
  });
});

describe("groupByCategory / filterGroups", () => {
  const groups = groupByCategory(rows);

  it("группирует по цеху, заявки без цеха — отдельной группой", () => {
    expect(groups.map((g) => [g.categoryName, g.items.length])).toEqual([
      ["Механический", 2],
      ["Без цеха", 1],
    ]);
  });

  it("фильтрует по цеху и по отсутствию цеха", () => {
    expect(filterGroups(groups, ALL_CATEGORIES)).toHaveLength(2);
    expect(filterGroups(groups, "c1").map((g) => g.categoryName)).toEqual(["Механический"]);
    expect(filterGroups(groups, NO_CATEGORY).map((g) => g.categoryName)).toEqual(["Без цеха"]);
    expect(filterGroups(groups, "unknown")).toEqual([]);
  });
});

describe("форматирование", () => {
  it("количество на экране — русская локаль, до 3 знаков", () => {
    expect(formatQuantity(1234.5).replace(/\s/g, " ")).toBe("1 234,5");
    expect(formatQuantity(0.125)).toBe("0,125");
  });

  it("CSV для Excel: BOM, «;», десятичная запятая, экранирование", () => {
    const csv = buildConsumptionCsv(
      groupByCategory([
        ...rows,
        { category_id: "c2", category_name: 'Цех "Север"; склад', material_id: "m3", material_name: "=HYPERLINK(1)", unit: "л", quantity: 1234.5 },
        { category_id: "c3", category_name: "Возврат", material_id: "m4", material_name: "Кабель", unit: "м", quantity: -1.25 },
      ]),
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Цех;Материал;Ед. изм.;Расход",
      "Механический;Электрод;кг;2,5",
      "Механический;Диск;шт;3",
      "Без цеха;Электрод;кг;1",
      `"Цех ""Север""; склад";'=HYPERLINK(1);л;1234,5`,
      "Возврат;Кабель;м;-1,25",
      "",
    ]);
  });
});
