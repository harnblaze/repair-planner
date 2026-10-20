import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MESSAGES,
  formatUploadErrors,
  mapAuthError,
  mapBoardMoveError,
  mapSupplyError,
  NOT_WORKING_DAY_MESSAGE,
} from "@/lib/errors";

describe("mapBoardMoveError", () => {
  it("maps a known RPC code", () => {
    expect(mapBoardMoveError("not_working_day")).toBe(NOT_WORKING_DAY_MESSAGE);
  });

  it("maps task_moved from move_backlog_task (0019)", () => {
    expect(mapBoardMoveError("task_moved")).toBe("Заявку только что переместили. Обновите страницу.");
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

describe("mapSupplyError", () => {
  it.each([
    ["supply_line_not_found", "Строка поставки не найдена. Обновите страницу."],
    ["already_received", "Эта поставка уже оприходована."],
    ["material_not_found", "Материал не найден. Обновите страницу."],
    ["invalid_quantity", "Проверьте количество."],
    ["access_denied", "Недостаточно прав для изменения данных проекта."],
    ["supply_lines_empty", "Добавьте хотя бы одну строку."],
    ["supply_parent_not_found", "Документ не найден. Обновите страницу."],
  ])("maps %s", (code, text) => {
    expect(mapSupplyError({ code: "P0001", message: code })).toBe(text);
  });

  it("explains a blocked delete of a received delivery", () => {
    expect(
      mapSupplyError({
        code: "23503",
        message:
          'update or delete on table "supply_delivery_lines" violates foreign key constraint "material_movements_supply_line_fk" on table "material_movements"',
      }),
    ).toBe("Нельзя удалить: материалы из этой поставки уже оприходованы. Исправьте остаток пересчётом в «Материалах».");
  });

  it("explains a link to an item of another request", () => {
    expect(
      mapSupplyError({
        code: "23503",
        message: 'insert or update on table "supply_invoice_lines" violates foreign key constraint "supply_invoice_lines_item_fk"',
      }),
    ).toBe("Позиция не найдена в этой заявке. Обновите страницу.");
  });

  it("maps an RLS denial to access_denied text", () => {
    expect(mapSupplyError({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      "Недостаточно прав для изменения данных проекта.",
    );
  });

  it("falls back to a generic text", () => {
    expect(mapSupplyError({ code: "XX000", message: "boom" })).toBe("Не удалось сохранить. Попробуйте ещё раз.");
    expect(mapSupplyError(null)).toBe("Не удалось сохранить. Попробуйте ещё раз.");
  });
});
