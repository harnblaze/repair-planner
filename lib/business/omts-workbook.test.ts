import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { OmtsHeaderInput } from "@/lib/validation/omts-request";

import { parseOrderItem } from "./omts-request";
import { buildOmtsWorkbook } from "./omts-workbook";

const header: OmtsHeaderInput = {
  month: "2026-10",
  organization: "ООО «РК-Гранд»",
  department: "ремонтно-строительного цеха (РСЦ)",
  signerTitle: "Начальник цеха",
  signerName: "Иванов И.И.",
};

async function load(h: OmtsHeaderInput, titles: [string, string | null][]) {
  const buffer = await buildOmtsWorkbook(
    h,
    titles.map(([t, n]) => parseOrderItem(t, n)),
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe("buildOmtsWorkbook", () => {
  it("раскладывает шапку, таблицу и подпись по макету", async () => {
    const wb = await load(header, [
      ["Петли - 30 шт", "срочно"],
      ["Пена монтажная", null],
    ]);
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Заявка");
    expect(ws.getCell("B2").value).toBe("В ОМТС");
    expect(ws.getCell("A7").value).toBe("ЗАЯВКА");
    expect(ws.getCell("A8").value).toBe("от ремонтно-строительного цеха (РСЦ)");
    expect(ws.getCell("A9").value).toBe("на приобретение ТМЦ в октябре 2026 г.");
    expect(ws.getCell("H4").value).toBe("ООО «РК-Гранд»");
    expect(ws.getCell("A12").value).toBe(1);
    expect(ws.getCell("B12").value).toBe("Петли");
    expect(ws.getCell("F12").value).toBe("шт");
    expect(ws.getCell("G12").value).toBe(30);
    expect(ws.getCell("H12").value).toBe("срочно");
    expect(ws.getCell("A13").value).toBe(2);
    expect(ws.getCell("B13").value).toBe("Пена монтажная");
    expect(ws.getCell("G13").value).toBeNull();
    expect(ws.getCell("C12").isMerged && ws.getCell("C12").master.address).toBe("B12");
    expect(ws.getCell("J13").master.address).toBe("H13");
    expect(ws.getCell("C16").value).toBe("Начальник цеха:");
    expect(ws.getCell("H16").value).toBe("Иванов И.И.");
    expect(ws.getCell("B12").border.left?.style).toBe("thin");
    // Количество — обычное число без особого формата.
    expect(ws.getCell("G12").numFmt).not.toBe("0.###");
    expect(typeof ws.getCell("G12").value).toBe("number");
    expect(ws.getColumn("G").width).toBe(15);
  });

  it("кегли: таблица 14, текст вокруг 18, «ЗАЯВКА» 22", async () => {
    const wb = await load(header, [["Петли - 30 шт", "срочно"]]);
    const ws = wb.worksheets[0];
    for (const addr of ["A11", "B11", "H11", "A12", "B12", "F12", "G12", "H12", "K12"]) {
      expect(ws.getCell(addr).font?.size, addr).toBe(14);
    }
    for (const addr of ["B2", "H4", "A8", "A9", "C15", "H15"]) {
      expect(ws.getCell(addr).font?.size, addr).toBe(18);
    }
    expect(ws.getCell("A7").font?.size).toBe(22);
    expect(ws.getCell("A7").font?.bold).toBe(true);
    // Строки под крупный кегль выше стандартных 15 пт.
    expect(ws.getRow(7).height).toBeGreaterThanOrEqual(28);
    expect(ws.getRow(8).height).toBeGreaterThanOrEqual(23);
    expect(ws.getRow(15).height).toBeGreaterThanOrEqual(23);
  });

  it("высота строки растёт с длиной наименования и примечания", async () => {
    const wb = await load(header, [
      ["Х".repeat(200) + " - 1 шт", null],
      ["Петли - 30 шт", null],
      ["Гвозди - 5 кг", "п".repeat(100)],
    ]);
    const ws = wb.worksheets[0];
    expect(ws.getRow(12).height).toBeGreaterThan(19);
    expect(ws.getRow(13).height).toBe(19);
    expect(ws.getRow(14).height).toBeGreaterThan(19);
    expect(ws.getRow(12).height).toBeLessThanOrEqual(409);
  });

  it("перенос текста включён в B и H (и в их объединённых диапазонах), в шапке тоже", async () => {
    const wb = await load(header, [["Х".repeat(200) + " - 1 шт", "п".repeat(100)]]);
    const ws = wb.worksheets[0];
    for (const addr of ["B12", "C12", "D12", "H12", "I12", "J12", "B11", "H11"]) {
      expect(ws.getCell(addr).alignment?.wrapText, addr).toBe(true);
    }
  });

  it("пустая должность и ФИО подписанта не оставляют «:» и пустой строки", async () => {
    const wb = await load({ ...header, signerTitle: "", signerName: "" }, [["Гвозди - 5 кг", null]]);
    const ws = wb.worksheets[0];
    expect(ws.getCell("C15").value).toBeNull();
    expect(ws.getCell("H15").value).toBeNull();
  });

  it("не превращает название в формулу", async () => {
    const wb = await load(header, [["=SUM(A1)", null]]);
    expect(typeof wb.worksheets[0].getCell("B12").value).toBe("string");
  });

  it("пустая организация — ячейка пустая", async () => {
    const wb = await load({ ...header, organization: "" }, [["Гвозди - 5 кг", null]]);
    expect(wb.worksheets[0].getCell("H4").value).toBeNull();
  });
});
