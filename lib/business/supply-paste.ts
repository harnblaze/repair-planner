// Разбор строк, вставленных из Excel / LibreOffice / Google Таблиц
// (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §6.3).
// Буфер обмена таблиц — TSV: строки через \n, ячейки через \t; ячейка с
// переносом строки или кавычкой берётся в кавычки, кавычка внутри удваивается.
//
// Колонки угадываются по содержимому, а не по позиции: в заявке цеха
// «№ / наименование / ГОСТ / ед. / кол-во / требования», в счёте —
// «наименование / кол-во / ед.». Нераспознанная строка не теряется:
// предпросмотр показывает её, мастер правит или удаляет.

export interface PastedRow {
  lineNo: number | null;
  name: string;
  unit: string;
  quantity: number | null;
  note: string;
  valid: boolean;
  raw: string;
}

const SPACES = "[ \\u00a0\\u202f\\u2009]";
const PLAIN_NUMBER = /^\d+(?:[.,]\d+)?$/;
const GROUPED_NUMBER = new RegExp(`^\\d{1,3}(?:${SPACES}\\d{3})+(?:[.,]\\d+)?$`);

/** "5,2" → 5.2, "1 500" → 1500; пробелы допустимы только как разделители тысяч. */
export function parseDecimal(raw: string): number | null {
  const value = raw.trim();
  if (!PLAIN_NUMBER.test(value) && !GROUPED_NUMBER.test(value)) return null;
  return Number(value.replace(new RegExp(SPACES, "g"), "").replace(",", "."));
}

export function splitTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cellStart) {
      inQuotes = true;
      cellStart = false;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
      cellStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      cellStart = true;
    } else if (ch === "\r") {
      // \r\n — перевод строки Windows; \n обработается на следующем шаге.
    } else {
      cell += ch;
      cellStart = false;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export function parsePastedRows(text: string): PastedRow[] {
  return splitTsv(text)
    .filter((cells) => cells.some((c) => c.trim() !== ""))
    .map(parseCells);
}

function parseCells(rawCells: string[]): PastedRow {
  const raw = rawCells.join("\t");
  const cells = rawCells.map((c) => c.replace(/\s+/g, " ").trim());
  const filled = cells.map((c, index) => ({ c, index })).filter((x) => x.c !== "");
  const isNumber = (c: string) => parseDecimal(c) !== null;

  const lineNoIndex = filled.length >= 4 && /^\d+$/.test(cells[0]) ? 0 : -1;
  const lineNo = lineNoIndex === 0 ? Number(cells[0]) : null;

  const quantityCell = [...filled].reverse().find((x) => x.index !== lineNoIndex && isNumber(x.c));
  const quantity = quantityCell ? parseDecimal(quantityCell.c) : null;

  const texts = filled.filter((x) => x.index !== lineNoIndex && !isNumber(x.c));
  const nameCell = texts.reduce<(typeof texts)[number] | undefined>(
    (best, x) => (!best || x.c.length > best.c.length ? x : best),
    undefined,
  );

  let unitIndex = -1;
  if (quantityCell) {
    const before = [...filled].reverse().find((x) => x.index < quantityCell.index);
    const after = filled.find((x) => x.index > quantityCell.index);
    if (before && !isNumber(before.c) && before.index !== nameCell?.index && before.index !== lineNoIndex) {
      unitIndex = before.index;
    } else if (after && !isNumber(after.c) && after.index !== nameCell?.index) {
      unitIndex = after.index;
    }
  }

  const note = quantityCell
    ? texts
        .filter((x) => x.index > quantityCell.index && x.index !== unitIndex && x.index !== nameCell?.index)
        .map((x) => x.c)
        .join("; ")
    : "";

  const name = nameCell?.c ?? "";
  const unit = unitIndex >= 0 ? cells[unitIndex] : "";

  return {
    lineNo,
    name,
    unit,
    quantity,
    note,
    valid: name !== "" && unit !== "" && quantity !== null && quantity > 0,
    raw,
  };
}

/**
 * № п/п строкам без номера: следующий после наибольшего встреченного
 * (среди уже сохранённых строк документа — `after` — и вставленных выше).
 */
export function numberRows<T extends { lineNo: number | null }>(
  rows: T[],
  after: number,
): (Omit<T, "lineNo"> & { lineNo: number })[] {
  let max = after;
  return rows.map((row) => {
    const lineNo = row.lineNo ?? max + 1;
    max = Math.max(max, lineNo);
    return { ...row, lineNo };
  });
}
