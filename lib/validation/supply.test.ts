import { describe, expect, it } from "vitest";

import {
  positiveQuantity,
  supplyDeliverySchema,
  supplyInvoiceSchema,
  supplyItemSchema,
  supplyReceiveSchema,
  supplyRequestSchema,
} from "./supply";

const ID = "5a000000-0000-0000-0000-000000000001";

describe("positiveQuantity", () => {
  it.each([
    ["5,2", 5.2],
    ["1 500", 1500],
    [" 18.2 ", 18.2],
    [3, 3],
  ])("accepts %j", (raw, expected) => {
    expect(positiveQuantity.parse(raw)).toBe(expected);
  });

  it.each(["", "0", "abc", "1e12", "-1", 0])("rejects %j", (raw) => {
    expect(positiveQuantity.safeParse(raw).success).toBe(false);
  });

  it("says «Введите число» for an empty field", () => {
    expect(positiveQuantity.safeParse("").error?.issues[0].message).toBe("Введите число");
  });
});

describe("supplyRequestSchema", () => {
  it("trims and accepts a request", () => {
    expect(supplyRequestSchema.parse({ number: " 14 ", requestDate: "2026-10-01", description: "" })).toEqual({
      number: "14",
      requestDate: "2026-10-01",
      description: "",
    });
  });

  it("rejects a blank number", () => {
    expect(supplyRequestSchema.safeParse({ number: "   ", requestDate: "2026-10-01" }).success).toBe(false);
  });

  it("rejects a non-ISO date", () => {
    expect(supplyRequestSchema.safeParse({ number: "14", requestDate: "20.10.2026" }).success).toBe(false);
  });
});

describe("supplyItemSchema", () => {
  it("accepts a pasted item with decimal comma", () => {
    expect(supplyItemSchema.parse({ lineNo: 4, name: "Линолеум", unit: "пог. м", quantity: "5,2" }).quantity).toBe(5.2);
  });

  it("requires a unit", () => {
    expect(supplyItemSchema.safeParse({ lineNo: 1, name: "Подвес", unit: " ", quantity: 1 }).success).toBe(false);
  });
});

describe("supplyInvoiceSchema", () => {
  it("allows empty amount and unpaid", () => {
    const parsed = supplyInvoiceSchema.parse({
      number: "89598",
      invoiceDate: "2026-10-08",
      supplier: "ТД ЦСК",
      amount: "",
      paidOn: null,
    });
    expect(parsed.amount).toBeNull();
    expect(parsed.paidOn).toBeNull();
  });

  it("parses amount with decimal comma", () => {
    expect(
      supplyInvoiceSchema.parse({ number: "1", invoiceDate: "2026-10-08", supplier: "ЦСК", amount: "123 141,44", paidOn: null })
        .amount,
    ).toBe(123141.44);
  });
});

describe("supplyDeliverySchema", () => {
  it("requires at least one line", () => {
    const result = supplyDeliverySchema.safeParse({ number: "84009", deliveryDate: "2026-10-16", lines: [] });
    expect(result.error?.issues[0].message).toBe("Отметьте хотя бы одну строку");
  });

  it("accepts a line", () => {
    expect(
      supplyDeliverySchema.parse({
        number: "84009",
        deliveryDate: "2026-10-16",
        lines: [{ invoiceLineId: ID, quantity: "18,2" }],
      }).lines[0].quantity,
    ).toBe(18.2);
  });
});

describe("supplyReceiveSchema", () => {
  it("asks to choose a material", () => {
    expect(supplyReceiveSchema.safeParse({ materialId: "", quantity: 1 }).error?.issues[0].message).toBe(
      "Выберите материал",
    );
  });
});
