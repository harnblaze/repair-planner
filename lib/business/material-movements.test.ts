import { describe, expect, it } from "vitest";

import { movementLabel, withBalanceAfter } from "./material-movements";

describe("movementLabel", () => {
  it("names receipts and consumption", () => {
    expect(movementLabel("receipt", null)).toBe("Приход");
    expect(movementLabel("consumption", "t1")).toBe("Списание");
  });

  it("distinguishes consumption edits from manual adjustments", () => {
    expect(movementLabel("adjustment", "t1")).toBe("Правка расхода");
    expect(movementLabel("adjustment", null)).toBe("Корректировка");
  });
});

describe("withBalanceAfter", () => {
  it("walks back from the current balance, newest first", () => {
    const result = withBalanceAfter(7.5, [
      { id: "adjustment", quantity: -2.5 },
      { id: "consumption", quantity: -3 },
      { id: "receipt", quantity: 13 },
    ]);

    expect(result.map((m) => [m.id, m.balanceAfter])).toEqual([
      ["adjustment", 7.5],
      ["consumption", 10],
      ["receipt", 13],
    ]);
  });

  it("keeps negative balances and avoids float drift", () => {
    const result = withBalanceAfter(-0.3, [
      { quantity: -0.1 },
      { quantity: -0.2 },
    ]);

    expect(result.map((m) => m.balanceAfter)).toEqual([-0.3, -0.2]);
  });

  it("returns an empty list for no movements", () => {
    expect(withBalanceAfter(5, [])).toEqual([]);
  });
});
