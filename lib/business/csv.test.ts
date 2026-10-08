import { describe, expect, it } from "vitest";

import { buildCsv, csvNumber, csvText } from "./csv";

describe("csv", () => {
  it("текст: формулы — с апострофом, «;» и кавычки — в кавычках", () => {
    expect(csvText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvText("-5")).toBe("'-5");
    expect(csvText('Цех "Север"; склад')).toBe('"Цех ""Север""; склад"');
    expect(csvText("Механический")).toBe("Механический");
  });

  it("число — десятичная запятая, без разделителя тысяч", () => {
    expect(csvNumber(1234.5)).toBe("1234,5");
    expect(csvNumber(-1.25)).toBe("-1,25");
    expect(csvNumber(0.1 + 0.2)).toBe("0,3");
  });

  it("файл — BOM, «;», CRLF и перевод строки в конце", () => {
    expect(buildCsv([["a", "b"], ["c", "d"]])).toBe("﻿a;b\r\nc;d\r\n");
  });
});
