// Заявка в ОМТС из пунктов списка «Материалы к заказу»: разбор строки
// «наименование - количество единица» и строки для буфера обмена.
// Без серверных и клиентских импортов — используется и там, и там.

import { csvNumber } from "./csv";
import { parseDecimal } from "./supply-paste";

export interface OmtsRow {
  name: string;
  unit: string;
  quantity: number | null;
  note: string;
  /** false — количество не распознано, наименование = весь текст пункта. */
  parsed: boolean;
}

// Разделитель — дефис/тире с пробелом хотя бы с одной стороны, так что
// «Т-24/29», «OSB-3 8 мм» не делятся. Наименование жадное: делим по последнему
// подходящему разделителю. В числе допустимы пробелы и NBSP (тысячи).
// Единица не начинается с «х/x/×/*» перед цифрой («3x2.5 мм», «50х50» — это
// размеры, а не единица) и не содержит тире («30 шт - срочно» не распознаём).
const ITEM_RE =
  /^(.*\S)(?:\s+[-–—]\s*|\s*[-–—]\s+)(\d[\d \u00a0\u202f\u2009]*(?:[.,]\d+)?)\s*(?![xXхХ×*]\s*\d)([A-Za-zА-Яа-яЁё][^-–—]{0,29})$/;

export function parseOrderItem(title: string, note: string | null): OmtsRow {
  const text = title.trim();
  const cleanNote = (note ?? "").trim();
  const match = ITEM_RE.exec(text);
  if (match) {
    const quantity = parseDecimal(match[2]);
    if (quantity !== null && quantity > 0) {
      return { name: match[1].trim(), unit: match[3].trim(), quantity, note: cleanNote, parsed: true };
    }
  }
  return { name: text, unit: "", quantity: null, note: cleanNote, parsed: false };
}

// Предложный падеж — для текста заявки, именительный — для имени файла.
const MONTHS_PREPOSITIONAL = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];
const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function splitMonth(month: string): { year: string; index: number } {
  const [year, mm] = month.split("-");
  return { year, index: Number(mm) - 1 };
}

/** "2026-10" → "в октябре 2026 г." */
export function omtsMonthPhrase(month: string): string {
  const { year, index } = splitMonth(month);
  return `в ${MONTHS_PREPOSITIONAL[index]} ${year} г.`;
}

/** "2026-10" → "октябрь 2026" */
export function omtsMonthLabel(month: string): string {
  const { year, index } = splitMonth(month);
  return `${MONTHS_NOMINATIVE[index]} ${year}`;
}

function flat(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

// Текстовая ячейка для вставки в Excel: ведущий апостроф не даёт принять
// «=…», «+7…», «-…», «@…» за формулу или число; ячейка с кавычкой берётся
// в кавычки с удвоением внутренних (так их читает и splitTsv).
function tsvText(value: string): string {
  const text = flat(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return safe.includes('"') ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Строки таблицы для вставки в Excel: 11 колонок A–K шаблона, без шапки. */
export function buildOmtsTsv(rows: OmtsRow[]): string {
  return rows
    .map((row, i) =>
      [
        String(i + 1), tsvText(row.name), "", "", "", tsvText(row.unit),
        row.quantity === null ? "" : csvNumber(row.quantity),
        tsvText(row.note), "", "", "",
      ].join("\t") + "\r\n",
    )
    .join("");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Та же таблица в HTML (без шапки) — Excel сохраняет объединение B:D и H:J. */
export function buildOmtsHtml(rows: OmtsRow[]): string {
  // Текстовые ячейки помечены форматом «Текст»: иначе Excel превратит «+7 912…»
  // или «-1» в число; количество остаётся числом.
  const TEXT_STYLE = ` style="mso-number-format:'\\@'"`;
  const td = (value: string, colspan?: number, text = true) =>
    `<td${colspan ? ` colspan="${colspan}"` : ""}${text ? TEXT_STYLE : ""}>${escapeHtml(flat(value))}</td>`;
  const body = rows
    .map((row, i) =>
      "<tr>" +
      td(String(i + 1)) +
      td(row.name, 3) +
      td("") +
      td(row.unit) +
      td(row.quantity === null ? "" : csvNumber(row.quantity), undefined, false) +
      td(row.note, 3) +
      td("") +
      "</tr>",
    )
    .join("");
  return `<table>${body}</table>`;
}
