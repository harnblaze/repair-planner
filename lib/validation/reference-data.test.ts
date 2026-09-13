import { describe, expect, it } from "vitest";

import { materialCountSchema, materialReceiptSchema } from "./reference-data";

describe("materialCountSchema", () => {
  it("rejects an empty count instead of treating it as zero", () => {
    expect(materialCountSchema.safeParse({ actualBalance: "" }).success).toBe(false);
    expect(materialCountSchema.safeParse({ actualBalance: "  " }).success).toBe(false);
  });

  it("accepts zero and decimals, rejects negatives", () => {
    expect(materialCountSchema.parse({ actualBalance: "0" }).actualBalance).toBe(0);
    expect(materialCountSchema.parse({ actualBalance: "7.5", note: " пересчёт " })).toEqual({
      actualBalance: 7.5,
      note: "пересчёт",
    });
    expect(materialCountSchema.safeParse({ actualBalance: "-1" }).success).toBe(false);
  });
});

describe("materialReceiptSchema", () => {
  it("requires a positive quantity", () => {
    expect(materialReceiptSchema.safeParse({ quantity: "" }).success).toBe(false);
    expect(materialReceiptSchema.safeParse({ quantity: "0" }).success).toBe(false);
    expect(materialReceiptSchema.safeParse({ quantity: "abc" }).success).toBe(false);
    expect(materialReceiptSchema.parse({ quantity: 2 }).quantity).toBe(2);
  });

  it("rejects values that overflow numeric(14, 3)", () => {
    expect(materialReceiptSchema.safeParse({ quantity: "1e12" }).success).toBe(false);
  });
});
