import { describe, expect, it } from "vitest";

import {
  buildPeriodCsv,
  defaultPeriod,
  formatLastMoved,
  formatPeriodLabel,
  isIsoDate,
  isMoved,
  matchPreset,
  periodQuery,
  presetPeriod,
  resolvePeriod,
  sortPeriodRows,
  summarizePeriod,
  toPeriodRow,
  type PeriodRow,
} from "./materials-period";

const TODAY = "2026-11-03";

function row(overrides: Partial<PeriodRow> = {}): PeriodRow {
  return {
    materialId: "m1",
    name: "Электрод",
    unit: "кг",
    receipt: 0,
    consumption: 0,
    adjustment: 0,
    balanceAtEnd: 0,
    lastMovedAt: null,
    ...overrides,
  };
}

describe("isIsoDate", () => {
  it("принимает существующие даты", () => {
    expect(isIsoDate("2026-11-03")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("отклоняет несуществующие и мусор", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("03.11.2026")).toBe(false);
    expect(isIsoDate("2026-11")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(20261103)).toBe(false);
  });
});

describe("периоды", () => {
  it("по умолчанию — с первого числа месяца по сегодня", () => {
    expect(defaultPeriod(TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-03" });
  });

  it("прошлый месяц — с первого по последнее число", () => {
    expect(presetPeriod("last-month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("прошлый месяц переходит через год", () => {
    expect(presetPeriod("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("три месяца — два предыдущих и текущий по сегодня", () => {
    expect(presetPeriod("three-months", TODAY)).toEqual({ from: "2026-09-01", to: "2026-11-03" });
  });

  it("узнаёт пресет по периоду", () => {
    expect(matchPreset({ from: "2026-10-01", to: "2026-10-31" }, TODAY)).toBe("last-month");
    expect(matchPreset({ from: "2026-09-01", to: "2026-11-03" }, TODAY)).toBe("three-months");
    expect(matchPreset({ from: "2026-10-05", to: "2026-10-20" }, TODAY)).toBeNull();
  });
});

describe("resolvePeriod", () => {
  it("берёт корректный период из параметров", () => {
    expect(resolvePeriod("2026-10-01", "2026-10-31", TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      invalid: false,
    });
  });

  it("откатывается на месяц по умолчанию, если начало позже конца", () => {
    expect(resolvePeriod("2026-11-05", "2026-11-01", TODAY)).toEqual({
      from: "2026-11-01",
      to: "2026-11-03",
      invalid: true,
    });
  });

  it("откатывается на месяц по умолчанию при мусоре в параметрах", () => {
    expect(resolvePeriod("завтра", "2026-11-01", TODAY).invalid).toBe(true);
    expect(resolvePeriod(undefined, undefined, TODAY)).toEqual({
      from: "2026-11-01",
      to: "2026-11-03",
      invalid: true,
    });
  });

  it("разрешает период в один день", () => {
    expect(resolvePeriod("2026-10-15", "2026-10-15", TODAY).invalid).toBe(false);
  });
});

describe("подписи и запрос", () => {
  it("период внутри месяца", () => {
    expect(formatPeriodLabel("2026-10-01", "2026-10-31")).toBe("1–31 октября 2026");
  });

  it("период через месяцы одного года", () => {
    expect(formatPeriodLabel("2026-09-01", "2026-11-03")).toBe("1 сентября — 3 ноября 2026");
  });

  it("период через годы", () => {
    expect(formatPeriodLabel("2025-12-20", "2026-01-10")).toBe("20 декабря 2025 — 10 января 2026");
  });

  it("query-строка содержит вкладку и даты", () => {
    const query = new URLSearchParams(periodQuery("2026-10-01", "2026-10-31"));
    expect(query.get("report")).toBe("period");
    expect(query.get("from")).toBe("2026-10-01");
    expect(query.get("to")).toBe("2026-10-31");
  });
});

describe("строки отчёта", () => {
  it("числа из RPC приводятся к number", () => {
    const parsed = toPeriodRow({
      material_id: "m1",
      name: "Электрод",
      unit: "кг",
      receipt: "10.000",
      consumption: "4.000",
      adjustment: "-2.000",
      balance_at_end: "8.000",
      last_moved_at: "2026-10-31T20:59:00+00:00",
    });

    expect(parsed).toEqual({
      materialId: "m1",
      name: "Электрод",
      unit: "кг",
      receipt: 10,
      consumption: 4,
      adjustment: -2,
      balanceAtEnd: 8,
      lastMovedAt: "2026-10-31T20:59:00+00:00",
    });
  });

  it("двигался ли материал", () => {
    expect(isMoved(row())).toBe(false);
    expect(isMoved(row({ adjustment: 1 }))).toBe(true);
    expect(isMoved(row({ receipt: 2 }))).toBe(true);
    expect(isMoved(row({ consumption: 2 }))).toBe(true);
  });

  it("сводка считает двигавшиеся, неподвижные и суммы", () => {
    const summary = summarizePeriod([
      row({ receipt: 10, consumption: 4, lastMovedAt: "2026-10-05T10:00:00+00:00" }),
      row({ name: "Краска", balanceAtEnd: 7 }),
      row({ name: "Диск", adjustment: 3 }),
    ]);

    expect(summary).toEqual({ moved: 2, still: 1, consumption: 4, receipt: 10 });
  });

  it("сортировка: расход по убыванию, затем название", () => {
    const sorted = sortPeriodRows([
      row({ materialId: "b", name: "Краска", consumption: 1 }),
      row({ materialId: "c", name: "Диск" }),
      row({ materialId: "a", name: "Электрод", consumption: 5 }),
      row({ materialId: "d", name: "Болт" }),
    ]);

    expect(sorted.map((item) => item.name)).toEqual(["Электрод", "Краска", "Болт", "Диск"]);
  });

  it("последнее движение: дата или прочерк", () => {
    expect(formatLastMoved(row({ lastMovedAt: "2026-10-31T20:59:00+00:00" }), "Europe/Moscow")).toBe("31.10.2026");
    expect(formatLastMoved(row(), "Europe/Moscow")).toBe("—");
  });
});

describe("buildPeriodCsv", () => {
  it("шапка, разделитель и строки совпадают с экраном", () => {
    const csv = buildPeriodCsv(
      [
        row({ receipt: 10, consumption: 4.5, balanceAtEnd: 8, lastMovedAt: "2026-10-31T20:59:00+00:00" }),
        row({ name: "Краска", balanceAtEnd: 7 }),
      ],
      "Europe/Moscow",
    );

    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Материал;Ед. изм.;Приход;Расход;Корректировка;Остаток на конец;Последнее движение");
    expect(lines[1]).toBe("Электрод;кг;10;4,5;0;8;31.10.2026");
    expect(lines[2]).toBe("Краска;кг;0;0;0;7;");
  });

  it("не ломает CSV названием с точкой с запятой", () => {
    const csv = buildPeriodCsv([row({ name: "Круг; отрезной", receipt: 1 })], "Europe/Moscow");
    expect(csv).toContain('"Круг; отрезной"');
  });
});
