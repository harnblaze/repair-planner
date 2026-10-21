import { describe, expect, it } from "vitest";

import { collectQuantities, numberRows, parseDecimal, parsePastedRows, splitTsv } from "./supply-paste";

describe("parseDecimal", () => {
  it.each([
    ["5,2", 5.2],
    ["1 500", 1500],
    ["1 500", 1500],
    ["1 500,5", 1500.5],
    ["18.2", 18.2],
    ["0", 0],
  ])("parses %j", (raw, expected) => {
    expect(parseDecimal(raw)).toBe(expected);
  });

  it.each(["", "шт", "1,2,3", "3,8х51"])("rejects %j", (raw) => {
    expect(parseDecimal(raw)).toBeNull();
  });
});

describe("splitTsv", () => {
  it("keeps a quoted cell with a newline in one row", () => {
    expect(splitTsv('6\t"Плинтус напольный\nКлассик 55"\tшт\t17')).toEqual([
      ["6", "Плинтус напольный\nКлассик 55", "шт", "17"],
    ]);
  });

  it("unescapes doubled quotes and handles CRLF", () => {
    expect(splitTsv('"ООО ""РК-Гранд"""\t1\r\nдругая\t2')).toEqual([
      ['ООО "РК-Гранд"', "1"],
      ["другая", "2"],
    ]);
  });
});

describe("parsePastedRows", () => {
  it("parses a request row with line number", () => {
    expect(parsePastedRows("1\tСаморезы по дереву 51мм\t\tшт\t1500\t")[0]).toMatchObject({
      lineNo: 1,
      name: "Саморезы по дереву 51мм",
      unit: "шт",
      quantity: 1500,
      note: "",
      valid: true,
    });
  });

  it("parses decimal comma, padded unit and a note", () => {
    expect(
      parsePastedRows("4\tЛинолеум коммерческий Centra Botticelli T93 3.5м\t\tпог. м \t5,2\tКаталог ЦСК")[0],
    ).toMatchObject({ unit: "пог. м", quantity: 5.2, note: "Каталог ЦСК", valid: true });
  });

  it("keeps the name when a ГОСТ cell is longer and moves ГОСТ to the note", () => {
    expect(parsePastedRows("2\tБолт\tГОСТ 7798-70 М12х50\tшт\t10")[0]).toMatchObject({
      lineNo: 2,
      name: "Болт",
      unit: "шт",
      quantity: 10,
      note: "ГОСТ 7798-70 М12х50",
      valid: true,
    });
  });

  it("keeps text cells before the quantity in the note", () => {
    expect(parsePastedRows("1\tЭлектрод МР-3\tГОСТ 9466-75\tкг\t5,2\tсрочно")[0]).toMatchObject({
      name: "Электрод МР-3",
      unit: "кг",
      quantity: 5.2,
      note: "ГОСТ 9466-75; срочно",
    });
  });

  it("parses an invoice row without line number, unit after quantity", () => {
    expect(parsePastedRows("Саморез по дереву 3,8х51 (500шт) в ведре\t3\tупак")[0]).toMatchObject({
      lineNo: null,
      name: "Саморез по дереву 3,8х51 (500шт) в ведре",
      unit: "упак",
      quantity: 3,
      valid: true,
    });
  });

  it("joins a multiline quoted cell with a space", () => {
    const rows = parsePastedRows('6\t"Плинтус напольный\nКлассик 55"\tшт\t17');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lineNo: 6, name: "Плинтус напольный Классик 55", quantity: 17, valid: true });
  });

  it("marks header and signature rows as not recognized", () => {
    const rows = parsePastedRows("№\tНаименование\tЕд.\tКол-во\n\tНачальник цеха:\tМинигулов А.Р.");
    expect(rows.map((r) => r.valid)).toEqual([false, false]);
  });

  it("drops empty lines", () => {
    const rows = parsePastedRows("\n\t\t\n1\tПодвес прямой\tшт\t230\r\n\r\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].raw).toBe("1\tПодвес прямой\tшт\t230");
  });
});

describe("numberRows", () => {
  it("keeps given numbers and continues after the largest one", () => {
    const rows = numberRows([{ lineNo: 4 }, { lineNo: null }, { lineNo: 2 }, { lineNo: null }], []);
    expect(rows.map((r) => r.lineNo)).toEqual([4, 5, 2, 6]);
  });

  it("starts after existing lines of the document", () => {
    expect(numberRows([{ lineNo: null }, { lineNo: null }], [1, 34]).map((r) => r.lineNo)).toEqual([35, 36]);
  });

  it("keeps original numbers that do not clash with existing lines", () => {
    expect(numberRows([{ lineNo: 4 }, { lineNo: 5 }], [1, 2, 3]).map((r) => r.lineNo)).toEqual([4, 5]);
  });

  it("renumbers the whole batch after existing lines when original numbers clash", () => {
    expect(
      numberRows([{ lineNo: 1 }, { lineNo: 2 }, { lineNo: 3 }, { lineNo: 4 }], [1, 2, 3]).map((r) => r.lineNo),
    ).toEqual([4, 5, 6, 7]);
  });

  it("renumbers a batch pasted twice with the same numbering", () => {
    expect(
      numberRows([{ lineNo: 1 }, { lineNo: 2 }, { lineNo: 1 }, { lineNo: 2 }], []).map((r) => r.lineNo),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe("collectQuantities", () => {
  it("skips empty and zero fields, keeps positive ones", () => {
    expect(
      collectQuantities([
        { id: "a", value: "8" },
        { id: "b", value: "" },
        { id: "c", value: "0" },
        { id: "d", value: "18,2" },
      ]),
    ).toEqual({ lines: [{ id: "a", quantity: "8" }, { id: "d", quantity: "18,2" }], invalidIds: [] });
  });

  it("reports unreadable input instead of dropping it", () => {
    expect(
      collectQuantities([
        { id: "a", value: "12,5кг" },
        { id: "b", value: "5..2" },
        { id: "c", value: "3" },
      ]).invalidIds,
    ).toEqual(["a", "b"]);
  });
});
