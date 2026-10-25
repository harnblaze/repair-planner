// Сборка .xlsx заявки в ОМТС по бумажному шаблону цеха.
// Только для сервера (Route Handler): exceljs тяжёлый, в клиентский бандл не тянем.
// Пакета server-only в проекте нет, поэтому ограничение держим договорённостью.

import ExcelJS from "exceljs";

import type { OmtsHeaderInput } from "@/lib/validation/omts-request";

import { omtsMonthPhrase, type OmtsRow } from "./omts-request";

const FONT: Partial<ExcelJS.Font> = { name: "Times New Roman", size: 11 };
const THIN: Partial<ExcelJS.Border> = { style: "thin" };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

// Ширины колонок A–K в символах, как в образце.
const COLUMN_WIDTHS = [5, 22, 14, 14, 10, 9, 12, 12, 12, 12, 14];

const TABLE_HEADER_ROW = 11;
const FIRST_ITEM_ROW = 12;

const HEADERS: Record<string, string> = {
  A: "№ п/п",
  B: "Наименование, обозначение, тип, марка ТМЦ",
  E: "ГОСТ, ТУ",
  F: "Ед. измер.",
  G: "Количество",
  H: "Особые требования (наличие сертификата, условия доставки, приёмки, завод-изготовитель и др.)",
  K: "Причина закупки",
};

export async function buildOmtsWorkbook(header: OmtsHeaderInput, rows: OmtsRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заявка", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  COLUMN_WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
    ws.getColumn(i + 1).font = FONT;
  });

  ws.getCell("B2").value = "В ОМТС";
  if (header.organization) ws.getCell("H4").value = header.organization;

  const title = (row: number, text: string, extra: Partial<ExcelJS.Font> = {}) => {
    ws.mergeCells(`A${row}:K${row}`);
    const cell = ws.getCell(`A${row}`);
    cell.value = text;
    cell.font = { ...FONT, ...extra };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  };
  title(7, "ЗАЯВКА", { bold: true, size: 14 });
  title(8, `от ${header.department}`);
  title(9, `на приобретение ТМЦ ${omtsMonthPhrase(header.month)}`);

  // Шапка таблицы: B:D и H:J объединены.
  const mergeRow = (row: number) => {
    ws.mergeCells(`B${row}:D${row}`);
    ws.mergeCells(`H${row}:J${row}`);
  };
  mergeRow(TABLE_HEADER_ROW);
  ws.getRow(TABLE_HEADER_ROW).height = 60;
  for (const [col, text] of Object.entries(HEADERS)) {
    ws.getCell(`${col}${TABLE_HEADER_ROW}`).value = text;
  }
  for (let c = 1; c <= 11; c++) {
    const cell = ws.getCell(TABLE_HEADER_ROW, c);
    cell.font = { ...FONT, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
  }

  rows.forEach((item, i) => {
    const r = FIRST_ITEM_ROW + i;
    mergeRow(r);
    // Значения — только строки и числа: строка «=SUM(A1)» exceljs пишет как текст, не формулу.
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = item.name;
    ws.getCell(`F${r}`).value = item.unit || null;
    if (item.quantity !== null) {
      ws.getCell(`G${r}`).value = item.quantity;
    }
    ws.getCell(`H${r}`).value = item.note || null;
    // Автовысоты у объединённых ячеек Excel не считает: оцениваем по длине текста
    // (B:D ≈ 48 символов в строке, H:J ≈ 34).
    ws.getRow(r).height = Math.min(
      409,
      15 * Math.max(1, Math.ceil(item.name.length / 48), Math.ceil(item.note.length / 34)),
    );
    for (let c = 1; c <= 11; c++) {
      const cell = ws.getCell(r, c);
      cell.font = FONT;
      cell.border = BORDER;
      cell.alignment = {
        vertical: "top",
        // Перенос — на весь объединённый диапазон (B:D, H:J): ячейки-«слейвы» делят стиль с мастером.
        wrapText: (c >= 2 && c <= 4) || (c >= 8 && c <= 10),
        horizontal: c === 1 || c >= 5 && c <= 7 ? "center" : undefined,
      };
    }
  });

  const signRow = FIRST_ITEM_ROW + rows.length - 1 + 3;
  ws.getCell(`C${signRow}`).value = header.signerTitle ? `${header.signerTitle}:` : null;
  ws.getCell(`C${signRow}`).font = FONT;
  ws.getCell(`H${signRow}`).value = header.signerName || null;
  ws.getCell(`H${signRow}`).font = FONT;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
