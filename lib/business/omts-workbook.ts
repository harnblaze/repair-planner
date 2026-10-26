// Сборка .xlsx заявки в ОМТС по бумажному шаблону цеха.
// Только для сервера (Route Handler): exceljs тяжёлый, в клиентский бандл не тянем.
// Пакета server-only в проекте нет, поэтому ограничение держим договорённостью.

import ExcelJS from "exceljs";

import type { OmtsHeaderInput } from "@/lib/validation/omts-request";

import { omtsMonthPhrase, type OmtsRow } from "./omts-request";

// Кегли: таблица — 14, текст вокруг неё — 18, слово «ЗАЯВКА» — 22.
const TEXT_FONT: Partial<ExcelJS.Font> = { name: "Times New Roman", size: 18 };
const TABLE_FONT: Partial<ExcelJS.Font> = { ...TEXT_FONT, size: 14 };
const TITLE_FONT: Partial<ExcelJS.Font> = { ...TEXT_FONT, size: 22, bold: true };

// Высота строки в пунктах на одну строку текста каждого кегля.
const TEXT_LINE = 24;
const TABLE_LINE = 19;
const THIN: Partial<ExcelJS.Border> = { style: "thin" };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

// Ширины колонок A–K в символах, как в образце; G шире — «Количество» 14-м жирным
// иначе рвётся посреди слова.
const COLUMN_WIDTHS = [5, 22, 14, 14, 10, 9, 15, 12, 12, 12, 14];

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
    ws.getColumn(i + 1).font = TEXT_FONT;
  });

  // Высоту строк вне таблицы задаём явно: Excel сам её под крупный кегль не поднимает.
  const text = (address: string, value: string) => {
    const cell = ws.getCell(address);
    cell.value = value;
    cell.font = TEXT_FONT;
    ws.getRow(Number(cell.row)).height = TEXT_LINE;
  };
  text("B2", "В ОМТС");
  if (header.organization) text("H4", header.organization);

  const title = (row: number, value: string, font: Partial<ExcelJS.Font>, height: number) => {
    ws.mergeCells(`A${row}:K${row}`);
    const cell = ws.getCell(`A${row}`);
    cell.value = value;
    cell.font = font;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = height;
  };
  title(7, "ЗАЯВКА", TITLE_FONT, 30);
  title(8, `от ${header.department}`, TEXT_FONT, TEXT_LINE);
  title(9, `на приобретение ТМЦ ${omtsMonthPhrase(header.month)}`, TEXT_FONT, TEXT_LINE);

  // Шапка таблицы: B:D и H:J объединены.
  const mergeRow = (row: number) => {
    ws.mergeCells(`B${row}:D${row}`);
    ws.mergeCells(`H${row}:J${row}`);
  };
  mergeRow(TABLE_HEADER_ROW);
  ws.getRow(TABLE_HEADER_ROW).height = 80;
  for (const [col, text] of Object.entries(HEADERS)) {
    ws.getCell(`${col}${TABLE_HEADER_ROW}`).value = text;
  }
  for (let c = 1; c <= 11; c++) {
    const cell = ws.getCell(TABLE_HEADER_ROW, c);
    cell.font = { ...TABLE_FONT, bold: true };
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
    // (14-м кеглем B:D ≈ 37 символов в строке, H:J ≈ 26).
    ws.getRow(r).height = Math.min(
      409,
      TABLE_LINE * Math.max(1, Math.ceil(item.name.length / 37), Math.ceil(item.note.length / 26)),
    );
    for (let c = 1; c <= 11; c++) {
      const cell = ws.getCell(r, c);
      cell.font = TABLE_FONT;
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
  if (header.signerTitle) text(`C${signRow}`, `${header.signerTitle}:`);
  if (header.signerName) text(`H${signRow}`, header.signerName);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
