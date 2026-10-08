import { describe, expect, it } from "vitest";

import {
  buildWorksCsv,
  filterWorkGroups,
  formatMaterials,
  groupWorksByCategory,
  worksReportQuery,
  type WorkRow,
} from "./works-report";

const row = (over: Partial<WorkRow>): WorkRow => ({
  task_id: "t1",
  title: "Ремонт насоса",
  completed_at: "2026-09-30T20:30:00Z",
  category_id: "c1",
  category_name: "Механический",
  category_sort_order: 1,
  executor_names: [],
  materials: [],
  ...over,
});

const rows: WorkRow[] = [
  row({ task_id: "t1", title: "Покраска щита", category_id: "c2", category_name: "Энергетический", category_sort_order: 0 }),
  row({ task_id: "t2", title: "Сварка рамы" }),
  row({
    task_id: "t3",
    title: "Ремонт насоса",
    executor_names: ["Иванов Иван", "Петров Пётр"],
    materials: [
      { name: "Краска", unit: "л", quantity: 1 },
      { name: "Электрод", unit: "кг", quantity: 2.5 },
    ],
  }),
  row({ task_id: "t4", title: "Без цеха работа", category_id: null, category_name: null, category_sort_order: null }),
];

describe("groupWorksByCategory", () => {
  it("группы в порядке строк RPC, «Без цеха» — подпись", () => {
    const groups = groupWorksByCategory(rows);
    expect(groups.map((g) => [g.categoryId, g.categoryName, g.works.map((w) => w.title)])).toEqual([
      ["c2", "Энергетический", ["Покраска щита"]],
      ["c1", "Механический", ["Сварка рамы", "Ремонт насоса"]],
      [null, "Без цеха", ["Без цеха работа"]],
    ]);
  });

  it("строка несёт исполнителей и материалы с числовым количеством", () => {
    const work = groupWorksByCategory([row({ materials: [{ name: "Диск", unit: "шт", quantity: "3" as unknown as number }] })])[0]
      .works[0];
    expect(work.materials).toEqual([{ name: "Диск", unit: "шт", quantity: 3 }]);
  });
});

describe("filterWorkGroups", () => {
  const groups = groupWorksByCategory(rows);

  it("все, без цеха, конкретный цех, неизвестный", () => {
    expect(filterWorkGroups(groups, "all")).toHaveLength(3);
    expect(filterWorkGroups(groups, "none").map((g) => g.categoryName)).toEqual(["Без цеха"]);
    expect(filterWorkGroups(groups, "c1").map((g) => g.categoryName)).toEqual(["Механический"]);
    expect(filterWorkGroups(groups, "c9")).toEqual([]);
  });
});

describe("formatMaterials", () => {
  it("«Краска 1 л; Электрод 2,5 кг», пусто — пустая строка", () => {
    expect(
      formatMaterials([
        { name: "Краска", unit: "л", quantity: 1 },
        { name: "Электрод", unit: "кг", quantity: 2.5 },
      ]),
    ).toBe("Краска 1 л; Электрод 2,5 кг");
    expect(formatMaterials([])).toBe("");
  });
});

describe("buildWorksCsv", () => {
  it("BOM, колонки, дата в timezone проекта, экранирование и защита от формул", () => {
    const csv = buildWorksCsv(
      groupWorksByCategory([
        ...rows,
        row({ task_id: "t5", title: '=1+1; "срочно"', category_id: "c1", completed_at: "2026-09-30T21:00:00Z" }),
      ]),
      "Europe/Moscow",
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Цех;Дата выполнения;Заявка;Исполнители;Материалы",
      "Энергетический;30.09.2026;Покраска щита;;",
      "Механический;30.09.2026;Сварка рамы;;",
      'Механический;30.09.2026;Ремонт насоса;Иванов Иван, Петров Пётр;"Краска 1 л; Электрод 2,5 кг"',
      `Механический;01.10.2026;"'=1+1; ""срочно""";;`,
      "Без цеха;30.09.2026;Без цеха работа;;",
      "",
    ]);
  });
});

describe("worksReportQuery", () => {
  it("вкладка, месяц, цех кроме «все»", () => {
    expect(worksReportQuery("2026-09", "all")).toBe("report=works&month=2026-09");
    expect(worksReportQuery("2026-09", "none")).toBe("report=works&month=2026-09&category=none");
  });
});
