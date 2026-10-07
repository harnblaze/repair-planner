import { describe, expect, it } from "vitest";
import { ATTACHMENT_MESSAGES, formatUploadErrors, mapAuthError, mapBoardMoveError, NOT_WORKING_DAY_MESSAGE } from "@/lib/errors";

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

describe("mapAuthError", () => {
  it("explains that email login is disabled in Supabase Auth", () => {
    expect(mapAuthError("Email logins are disabled")).toBe(
      "Вход по email временно недоступен. Обратитесь к администратору.",
    );
  });

  it("uses the generic message for an unknown error", () => {
    expect(mapAuthError("something unexpected")).toBe("Не удалось выполнить операцию. Попробуйте ещё раз.");
  });
});

describe("formatUploadErrors", () => {
  it("returns null when every photo was uploaded", () => {
    expect(formatUploadErrors([], 3)).toBeNull();
  });

  it("returns the reason itself for a single photo", () => {
    expect(formatUploadErrors([ATTACHMENT_MESSAGES.tooLarge], 1)).toBe(ATTACHMENT_MESSAGES.tooLarge);
  });

  it("counts failures and shows the first specific reason", () => {
    expect(
      formatUploadErrors([ATTACHMENT_MESSAGES.uploadFailed, ATTACHMENT_MESSAGES.unsupported], 5),
    ).toBe(`Не удалось загрузить 2 фото из 5. ${ATTACHMENT_MESSAGES.unsupported}`);
  });

  it("does not repeat the generic text when there is no specific reason", () => {
    expect(formatUploadErrors([ATTACHMENT_MESSAGES.uploadFailed], 3)).toBe(
      "Не удалось загрузить 1 фото из 3. Попробуйте ещё раз.",
    );
  });
});
