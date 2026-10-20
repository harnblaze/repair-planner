import { describe, expect, it } from "vitest";

import type {
  SupplyInvoiceLineView,
  SupplyInvoiceView,
  SupplyItemView,
  SupplyRequestView,
} from "@/lib/types/supply";

import { lineProgress, remainingToDeliver, summarizeRequest } from "./supply-status";

function item(id: string, overrides: Partial<SupplyItemView> = {}): SupplyItemView {
  return { id, lineNo: 1, name: id, unit: "шт", quantity: 1, note: null, materialId: null, cancelled: false, ...overrides };
}

function line(id: string, requestItemId: string | null, quantity: number, delivered: number[] = []): SupplyInvoiceLineView {
  return {
    id,
    invoiceId: "inv",
    requestItemId,
    lineNo: 1,
    name: id,
    unit: "шт",
    quantity,
    deliveries: delivered.map((q, i) => ({ id: `${id}-d${i}`, deliveryId: `d${i}`, quantity: q, received: false })),
  };
}

function invoice(id: string, paidOn: string | null, lines: SupplyInvoiceLineView[]): SupplyInvoiceView {
  return { id, number: id, invoiceDate: "2026-10-08", supplier: "ЦСК", amount: null, paidOn, lines };
}

function request(items: SupplyItemView[], invoices: SupplyInvoiceView[]): SupplyRequestView {
  return { id: "r", number: "14", requestDate: "2026-10-01", description: null, items, invoices, deliveries: [] };
}

describe("lineProgress", () => {
  it("is none when nothing delivered", () => {
    expect(lineProgress(line("l", null, 13))).toEqual({ state: "none", delivered: 0, over: false });
  });

  it("sums several deliveries into partial", () => {
    expect(lineProgress(line("l", null, 13, [5, 3]))).toEqual({ state: "partial", delivered: 8, over: false });
  });

  it("is full when delivered equals quantity", () => {
    expect(lineProgress(line("l", null, 13, [13]))).toEqual({ state: "full", delivered: 13, over: false });
  });

  it("flags over-delivery", () => {
    expect(lineProgress(line("l", null, 13, [15]))).toEqual({ state: "full", delivered: 15, over: true });
  });

  it("does not suffer from float drift on decimals", () => {
    expect(lineProgress(line("l", null, 0.3, [0.1, 0.2])).state).toBe("full");
  });
});

describe("remainingToDeliver", () => {
  it("is quantity minus delivered", () => {
    expect(remainingToDeliver(line("l", null, 13, [8]))).toBe(5);
  });

  it("is 0 for an over-delivered line", () => {
    expect(remainingToDeliver(line("l", null, 13, [15]))).toBe(0);
  });
});

describe("summarizeRequest: item status", () => {
  it("cancelled wins over linked lines", () => {
    const s = summarizeRequest(request([item("a", { cancelled: true })], [invoice("i", "2026-10-14", [line("l", "a", 1, [1])])]));
    expect(s.items.a).toBe("cancelled");
  });

  it("no_invoice without linked lines", () => {
    expect(summarizeRequest(request([item("a")], [])).items.a).toBe("no_invoice");
  });

  it("unpaid when a linked invoice is not paid", () => {
    expect(summarizeRequest(request([item("a")], [invoice("i", null, [line("l", "a", 1)])])).items.a).toBe("unpaid");
  });

  it("paid when all linked invoices are paid", () => {
    expect(summarizeRequest(request([item("a")], [invoice("i", "2026-10-14", [line("l", "a", 1)])])).items.a).toBe("paid");
  });

  it("partial when something arrived, even on an unpaid invoice", () => {
    expect(summarizeRequest(request([item("a")], [invoice("i", null, [line("l", "a", 13, [8])])])).items.a).toBe("partial");
  });

  it("delivered when all linked lines are full", () => {
    const s = summarizeRequest(
      request([item("a")], [invoice("i", "2026-10-14", [line("l1", "a", 1, [1]), line("l2", "a", 5, [5])])]),
    );
    expect(s.items.a).toBe("delivered");
  });

  it("partial when one of two lines is still missing", () => {
    const s = summarizeRequest(
      request([item("a")], [invoice("i", "2026-10-14", [line("l1", "a", 1, [1]), line("l2", "a", 5)])]),
    );
    expect(s.items.a).toBe("partial");
  });
});

describe("summarizeRequest: request", () => {
  it("is delivered when every non-cancelled item is delivered", () => {
    const s = summarizeRequest(
      request([item("a"), item("b", { cancelled: true })], [invoice("i", "2026-10-14", [line("l", "a", 2, [2])])]),
    );
    expect(s.status).toBe("delivered");
  });

  it("is active when empty", () => {
    expect(summarizeRequest(request([], [])).status).toBe("active");
  });

  it("is active when every item is cancelled", () => {
    expect(summarizeRequest(request([item("a", { cancelled: true })], [])).status).toBe("active");
  });

  it("ignores off-request lines", () => {
    const s = summarizeRequest(
      request([item("a")], [invoice("i", null, [line("l", "a", 1, [1]), line("nails", null, 2)])]),
    );
    expect(s.status).toBe("delivered");
    expect(s.invoiced).toBe(1);
    expect(s.lines.nails.state).toBe("none");
  });

  it("counts invoiced, paid and delivered over non-cancelled items", () => {
    const s = summarizeRequest(
      request(
        [item("none"), item("unpaid"), item("paid"), item("done"), item("gone", { cancelled: true })],
        [
          invoice("i1", null, [line("l1", "unpaid", 1)]),
          invoice("i2", "2026-10-14", [line("l2", "paid", 1), line("l3", "done", 1, [1])]),
        ],
      ),
    );
    expect({ total: s.total, invoiced: s.invoiced, paid: s.paid, delivered: s.delivered }).toEqual({
      total: 4,
      invoiced: 3,
      paid: 2,
      delivered: 1,
    });
  });
});
