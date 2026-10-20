import { describe, expect, it } from "vitest";

import type { SupplyRequestView } from "@/lib/types/supply";

import { filterSupplyRequests } from "./supply-filter";

const active: SupplyRequestView = {
  id: "active",
  number: "14",
  requestDate: "2026-10-01",
  description: "Материалы на кабинет",
  items: [{ id: "i1", lineNo: 1, name: "Ёлка новогодняя", unit: "шт", quantity: 1, note: null, materialId: null, cancelled: false }],
  invoices: [
    {
      id: "inv",
      number: "89598",
      invoiceDate: "2026-10-08",
      supplier: "ТД ЦСК Общестрой",
      amount: null,
      paidOn: null,
      lines: [
        { id: "l1", invoiceId: "inv", requestItemId: "i1", lineNo: 1, name: "Саморез 3,8х35 в ведре", unit: "упак", quantity: 1, deliveries: [] },
      ],
    },
  ],
  deliveries: [],
};

const delivered: SupplyRequestView = {
  id: "delivered",
  number: "13",
  requestDate: "2026-09-03",
  description: null,
  items: [{ id: "i2", lineNo: 1, name: "Краска", unit: "шт", quantity: 1, note: null, materialId: null, cancelled: false }],
  invoices: [
    {
      id: "inv2",
      number: "2656",
      invoiceDate: "2026-09-06",
      supplier: "Лемана ПРО",
      amount: null,
      paidOn: "2026-09-07",
      lines: [
        {
          id: "l2",
          invoiceId: "inv2",
          requestItemId: "i2",
          lineNo: 1,
          name: "Краска ВД",
          unit: "шт",
          quantity: 1,
          deliveries: [{ id: "dl", deliveryId: "d", quantity: 1, received: false }],
        },
      ],
    },
  ],
  deliveries: [],
};

const all = [active, delivered];
const ids = (opts: { query: string; onlyActive: boolean }) => filterSupplyRequests(all, opts).map((r) => r.id);

describe("filterSupplyRequests", () => {
  it("returns everything for an empty query", () => {
    expect(ids({ query: "  ", onlyActive: false })).toEqual(["active", "delivered"]);
  });

  it("finds by supplier", () => {
    expect(ids({ query: "цск", onlyActive: false })).toEqual(["active"]);
  });

  it("finds by invoice line name", () => {
    expect(ids({ query: "ведре", onlyActive: false })).toEqual(["active"]);
  });

  it("finds by description and number", () => {
    expect(ids({ query: "кабинет", onlyActive: false })).toEqual(["active"]);
    expect(ids({ query: "2656", onlyActive: false })).toEqual(["delivered"]);
  });

  it("treats ё as е and ignores case", () => {
    expect(ids({ query: "ЕЛКА", onlyActive: false })).toEqual(["active"]);
  });

  it("hides fully delivered requests when onlyActive", () => {
    expect(ids({ query: "", onlyActive: true })).toEqual(["active"]);
  });
});
