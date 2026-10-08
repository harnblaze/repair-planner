// CSV для Excel с русской локалью — общий для отчётов: BOM (иначе кириллица
// ломается), разделитель «;», десятичная запятая, без разделителя тысяч.

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Текст от пользователя (названия заявок, цехов, материалов, имена): ведущие
 * = + - @ Excel исполнил бы как формулу (CSV injection) — такие ячейки
 * начинаются с апострофа.
 */
export function csvText(value: string): string {
  return csvCell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

export function csvNumber(value: number): string {
  return String(Number(value.toFixed(3))).replace(".", ",");
}

export function buildCsv(lines: string[][]): string {
  return "﻿" + lines.map((cells) => cells.join(";")).join("\r\n") + "\r\n";
}
