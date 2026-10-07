import { describe, expect, it } from "vitest";
import { mapBoardMoveError, NOT_WORKING_DAY_MESSAGE } from "@/lib/errors";

describe("mapBoardMoveError", () => {
  it("maps a known RPC code", () => {
    expect(mapBoardMoveError("not_working_day")).toBe(NOT_WORKING_DAY_MESSAGE);
  });

  it("uses the generic fallback for an unknown error", () => {
    expect(mapBoardMoveError("duplicate key value")).toBe("Не удалось переместить. Попробуйте ещё раз.");
  });

  it("uses a caller-provided fallback for an unknown error", () => {
    expect(mapBoardMoveError("duplicate key value", "Не удалось изменить план. Попробуйте ещё раз.")).toBe(
      "Не удалось изменить план. Попробуйте ещё раз.",
    );
  });
});
