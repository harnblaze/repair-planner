import { describe, expect, it } from "vitest";

import { monthRange } from "./archive-periods";

describe("monthRange", () => {
  it("этот месяц", () => {
    expect(monthRange("2026-10-08", 0)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("прошлый месяц через границу года", () => {
    expect(monthRange("2026-01-15", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("февраль обычного и високосного года", () => {
    expect(monthRange("2026-03-31", -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-03-10", -1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
