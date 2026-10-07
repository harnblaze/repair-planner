import { describe, expect, it } from "vitest";

import { isSubmittablePlanDate } from "./plan-date-input";

describe("isSubmittablePlanDate", () => {
  it("accepts an empty value — clearing the plan", () => {
    expect(isSubmittablePlanDate("")).toBe(true);
  });

  it("accepts a complete date", () => {
    expect(isSubmittablePlanDate("2026-10-08")).toBe(true);
  });

  it("rejects intermediate years while the year is being typed", () => {
    expect(isSubmittablePlanDate("0002-10-08")).toBe(false);
    expect(isSubmittablePlanDate("0020-10-08")).toBe(false);
    expect(isSubmittablePlanDate("0202-10-08")).toBe(false);
  });

  it("rejects a malformed value", () => {
    expect(isSubmittablePlanDate("2026-02-30")).toBe(false);
    expect(isSubmittablePlanDate("08.10.2026")).toBe(false);
  });
});
