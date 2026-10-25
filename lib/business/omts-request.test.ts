import { describe, expect, it } from "vitest";

import { splitTsv } from "./supply-paste";

import {
  buildOmtsHtml,
  buildOmtsTsv,
  omtsMonthLabel,
  omtsMonthPhrase,
  parseOrderItem,
  type OmtsRow,
} from "./omts-request";

function row(name: string, unit: string, quantity: number | null, note: string): OmtsRow {
  return { name, unit, quantity, note, parsed: true };
}

describe("parseOrderItem", () => {
  it("разбирает «наименование - количество единица»", () => {
    expect(parseOrderItem("Петли дверные левые - 30 шт", null)).toEqual({
      name: "Петли дверные левые",
      unit: "шт",
      quantity: 30,
      note: "",
      parsed: true,
    });
  });

  it("дефисы внутри наименования не мешают: делит по последнему разделителю", () => {
    expect(parseOrderItem("Направляющая Т-24/29-120 Албес — 56 шт", "Каталог ЦСК")).toMatchObject({
      name: "Направляющая Т-24/29-120 Албес",
      unit: "шт",
      quantity: 56,
      note: "Каталог ЦСК",
    });
    expect(parseOrderItem("OSB-3 8 мм - 13 лист", null)).toMatchObject({
      name: "OSB-3 8 мм",
      quantity: 13,
      unit: "лист",
    });
  });

  it("количество с пробелом-разделителем тысяч, запятой и точкой", () => {
    expect(parseOrderItem("Саморезы по дереву 51мм -1 500 шт", null)).toMatchObject({ quantity: 1500, unit: "шт" });
    expect(parseOrderItem("Саморезы - 1 500 шт", null)).toMatchObject({ quantity: 1500 });
    expect(parseOrderItem("Линолеум - 0.5 м", null)).toMatchObject({ quantity: 0.5, unit: "м" });
  });

  it("единица из нескольких слов", () => {
    expect(parseOrderItem("Линолеум Centra 3.5м – 5,2 пог. м", null)).toMatchObject({
      name: "Линолеум Centra 3.5м",
      quantity: 5.2,
      unit: "пог. м",
    });
  });

  it("количество без пробела перед единицей", () => {
    expect(parseOrderItem("Петли - 30шт", null)).toMatchObject({ quantity: 30, unit: "шт" });
  });

  it("пункт без количества не теряется", () => {
    expect(parseOrderItem("Саморезы по дереву 51мм", null)).toEqual({
      name: "Саморезы по дереву 51мм",
      unit: "",
      quantity: null,
      note: "",
      parsed: false,
    });
    expect(parseOrderItem("OSB-3 8 мм", null).parsed).toBe(false);
    expect(parseOrderItem("Подвес прямой", null).parsed).toBe(false);
  });

  it("нулевое количество — пункт не распознан", () => {
    const item = parseOrderItem("Петли - 0 шт", null);
    expect(item.parsed).toBe(false);
    expect(item.name).toBe("Петли - 0 шт");
  });

  it("размеры вида 3x2.5 и хвост после единицы не дают неверных количества и единицы", () => {
    for (const title of [
      "Кабель ВВГ - 3x2.5 мм",
      "Шуруп - 3,5х25",
      "Брус - 50х50",
      "Петли - 30 шт - срочно",
    ]) {
      const item = parseOrderItem(title, null);
      expect(item.parsed, title).toBe(false);
      expect(item.name).toBe(title);
      expect(item.quantity).toBeNull();
    }
  });

  it("«Лампа - 2 шт по 40 Вт»: единица захватывает весь хвост (известное ограничение)", () => {
    expect(parseOrderItem("Лампа - 2 шт по 40 Вт", null)).toMatchObject({
      name: "Лампа",
      quantity: 2,
      unit: "шт по 40 Вт",
    });
  });

  it("тонкий пробел как разделитель тысяч", () => {
    expect(parseOrderItem("Саморезы - 1\u2009500 шт", null)).toMatchObject({ quantity: 1500, unit: "шт" });
  });

  it("обрезает пробелы, пустое примечание — пустая строка", () => {
    expect(parseOrderItem("  Пена монтажная  ", "  ").note).toBe("");
    expect(parseOrderItem("  Пена монтажная  ", null).name).toBe("Пена монтажная");
  });
});

describe("omtsMonthPhrase / omtsMonthLabel", () => {
  it("предложный падеж для текста заявки", () => {
    expect(omtsMonthPhrase("2026-10")).toBe("в октябре 2026 г.");
    expect(omtsMonthPhrase("2027-05")).toBe("в мае 2027 г.");
  });

  it("именительный падеж для имени файла", () => {
    expect(omtsMonthLabel("2026-03")).toBe("март 2026");
  });
});

describe("buildOmtsTsv", () => {
  it("раскладывает по колонкам A–K шаблона", () => {
    expect(buildOmtsTsv([row("Петли", "шт", 30, ""), row("Линолеум", "пог. м", 5.2, "Каталог ЦСК")])).toBe(
      "1\tПетли\t\t\t\tшт\t30\t\t\t\t\r\n2\tЛинолеум\t\t\t\tпог. м\t5,2\tКаталог ЦСК\t\t\t\r\n",
    );
  });

  it("табы и переводы строк в тексте не ломают разметку", () => {
    expect(buildOmtsTsv([row("А\tБ\nВ", "", null, "")])).toBe("1\tА Б В\t\t\t\t\t\t\t\t\t\r\n");
  });

  it("пустой список — пустая строка", () => {
    expect(buildOmtsTsv([])).toBe("");
  });

  it("ячейки, которые Excel принял бы за формулу или число, получают ведущий апостроф", () => {
    const tsv = buildOmtsTsv([row("=SUM(A1)", "", 1, "+7 912 000"), row("-без сертификата", "", 1, "@x")]);
    const [first, second] = splitTsv(tsv);
    expect(first[1]).toBe("'=SUM(A1)");
    expect(first[7]).toBe("'+7 912 000");
    expect(second[1]).toBe("'-без сертификата");
    expect(second[7]).toBe("'@x");
    // Число (количество) апострофа не получает.
    expect(first[6]).toBe("1");
  });

  it("ячейка с кавычкой берётся в кавычки, внутренние удваиваются; splitTsv читает обратно", () => {
    const tsv = buildOmtsTsv([row('Болт "М12"', "шт", 2, "")]);
    expect(tsv).toContain('"Болт ""М12"""');
    expect(splitTsv(tsv)[0][1]).toBe('Болт "М12"');
  });
});

describe("buildOmtsHtml", () => {
  it("экранирует спецсимволы и объединяет колонки", () => {
    const html = buildOmtsHtml([row("Болт <M12> & гайка", "шт", 10, "")]);
    expect(html).toContain("&lt;M12&gt; &amp; гайка");
    expect(html).toContain('colspan="3"');
    expect(html.match(/<tr>/g)).toHaveLength(1);
  });

  it("текстовые ячейки помечены как текст, количество остаётся числом", () => {
    const html = buildOmtsHtml([row("Х", "шт", 5, "+7 912")]);
    const style = `style="mso-number-format:'\\@'"`;
    expect(html).toContain(`<td ${style}>1</td>`);
    expect(html).toContain(`<td colspan="3" ${style}>Х</td>`);
    expect(html).toContain(`<td colspan="3" ${style}>+7 912</td>`);
    expect(html).toContain(`<td ${style}>шт</td>`);
    expect(html).toContain("<td>5</td>");
  });

  it("экранирует кавычки в примечании", () => {
    expect(buildOmtsHtml([row("Х", "шт", 1, 'ГОСТ "7798"')])).toContain("ГОСТ &quot;7798&quot;");
  });
});
