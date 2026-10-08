import { describe, expect, it } from "vitest";

import {
  ARCHIVE_QUERY_MAX,
  DEFAULT_ARCHIVE_FILTERS,
  archiveQuery,
  hasArchiveFilters,
  parseArchiveFilters,
} from "./archive-filters";

const CAT = "3f0c8a52-7d4b-4e7a-9c1e-5b2d6f8a9e10";
const EXE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MAT = "5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("parseArchiveFilters", () => {
  it("без параметров — значения по умолчанию", () => {
    expect(parseArchiveFilters({})).toEqual(DEFAULT_ARCHIVE_FILTERS);
  });

  it("разбирает все поля", () => {
    expect(
      parseArchiveFilters({
        view: "archive",
        q: "  насос ",
        status: "all",
        category: CAT,
        executor: EXE,
        material: MAT,
        from: "2026-09-01",
        to: "2026-09-30",
        page: "3",
      }),
    ).toEqual({
      q: "насос",
      status: "all",
      category: CAT,
      executor: EXE,
      material: MAT,
      from: "2026-09-01",
      to: "2026-09-30",
      page: 3,
    });
  });

  it("неверные значения заменяются значениями по умолчанию по отдельности", () => {
    expect(
      parseArchiveFilters({
        status: "open",
        category: "abc",
        executor: "",
        material: "электрод",
        from: "2026-02-30",
        to: "вчера",
        page: "0",
        q: "ok",
      }),
    ).toEqual({ ...DEFAULT_ARCHIVE_FILTERS, q: "ok" });
    expect(parseArchiveFilters({ page: "21" }).page).toBe(1);
    expect(parseArchiveFilters({ page: "2.5" }).page).toBe(1);
  });

  it("повторяющийся параметр — берётся первый", () => {
    expect(parseArchiveFilters({ q: ["первый", "второй"] }).q).toBe("первый");
  });

  it("длинный текст обрезается", () => {
    expect(parseArchiveFilters({ q: "я".repeat(150) }).q).toHaveLength(ARCHIVE_QUERY_MAX);
  });

  it("«с» позже «по» — даты меняются местами", () => {
    const f = parseArchiveFilters({ from: "2026-10-31", to: "2026-10-01" });
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-31"]);
  });
});

describe("archiveQuery", () => {
  it("по умолчанию — только вкладка", () => {
    expect(archiveQuery(DEFAULT_ARCHIVE_FILTERS)).toBe("view=archive");
  });

  it("пропускает значения по умолчанию и применяет overrides", () => {
    const filters = { ...DEFAULT_ARCHIVE_FILTERS, q: "насос", status: "all" as const, page: 2 };
    expect(archiveQuery(filters, { page: 3 })).toBe("view=archive&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&status=all&page=3");
    expect(archiveQuery(filters, { from: "2026-10-01", to: "2026-10-31", page: 1 })).toBe(
      "view=archive&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&status=all&from=2026-10-01&to=2026-10-31",
    );
  });

  it("разбор собранной строки возвращает те же фильтры", () => {
    const filters = {
      q: "ворота",
      status: "cancelled" as const,
      category: CAT,
      executor: EXE,
      material: MAT,
      from: null,
      to: "2026-09-30",
      page: 4,
    };
    const params = Object.fromEntries(new URLSearchParams(archiveQuery(filters)));
    expect(parseArchiveFilters(params)).toEqual(filters);
  });
});

describe("hasArchiveFilters", () => {
  it("значения по умолчанию и номер страницы — не фильтры", () => {
    expect(hasArchiveFilters(DEFAULT_ARCHIVE_FILTERS)).toBe(false);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, page: 3 })).toBe(false);
  });

  it("любой заданный фильтр", () => {
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, q: "насос" })).toBe(true);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, status: "cancelled" })).toBe(true);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, to: "2026-09-30" })).toBe(true);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, material: MAT })).toBe(true);
  });
});
