# Заявка в ОМТС из списка «Материалы к заказу» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Из невыполненных пунктов списка «Материалы к заказу» одной кнопкой получить заявку в ОМТС: скачать готовый .xlsx по образцу цеха или скопировать строки таблицы для вставки в свой файл.

**Architecture:** Разбор пункта «Наименование - 30 шт» и сборка строк — чистые функции в `lib/business/omts-request.ts` (общие для клиента и сервера). Файл собирает `exceljs` в Route Handler (POST) на сервере: пункты читаются серверным Supabase-клиентом под RLS, библиотека не попадает в браузер. Окно на доске открывается кнопкой в шапке панели списка; шапка/подпись заявки запоминаются в `localStorage`. База данных не меняется.

**Tech Stack:** Next.js 16 App Router (Route Handler), TypeScript, Zod, React Hook Form, `@base-ui/react` Dialog (через существующий `SupplyDialog`), `exceljs@4.4.0`, Vitest.

**Spec:** согласовано в чате 2026-10-25 (письменной спеки нет). Образец заявки цеха — лист 3 файла «ТМЦоктябрь2026г.(кабмех).xls»; его структура переписана ниже в «Макет файла».

## Global Constraints

- Новая зависимость только одна: `exceljs` (точная версия `4.4.0`), используется только на сервере (Route Handler). В клиентские компоненты не импортировать.
- Миграций нет, схема БД не меняется.
- В заявку попадают только пункты с `is_done = false`, в порядке `position, created_at`.
- Разбор пункта: `«<наименование> - <количество> <единица>»`; разделитель — `-`, `–` или `—` с пробелом хотя бы с одной стороны. Нераспознанный пункт не теряется: наименование = весь текст, количество и единица пустые.
- Примечание пункта → колонка «Особые требования». «ГОСТ, ТУ» и «Причина закупки» — пустые. Нумерация 1, 2, 3…
- Ошибки пользователю — понятным русским текстом, технические детали — в `console.error` (CLAUDE.md §31).
- Сообщения UI и комментарии в коде — на русском, в стиле окружающего кода.
- Субагенты не делают commit/push; коммит — координатор после приёмки и с разрешения пользователя (CLAUDE.md §39).
- Next.js 16: перед написанием Route Handler свериться с `node_modules/next/dist/docs/` (AGENTS.md), образец — `app/(app)/[projectId]/reports/export/route.ts`.

## Макет файла (лист «Заявка»)

Колонки A–K, как в образце: A «№ п/п», B:D «Наименование, обозначение, тип, марка ТМЦ» (объединены), E «ГОСТ, ТУ», F «Ед. измер.», G «Количество», H:J «Особые требования (наличие сертификата, условия доставки, приёмки, завод-изготовитель и др.)» (объединены), K «Причина закупки».

| Строка | Содержимое |
|---|---|
| 2 | B2: «В ОМТС» |
| 4 | H4: организация (если пусто — строка пропускается) |
| 7 | A7:K7 объединены, по центру, жирный, 14pt: «ЗАЯВКА» |
| 8 | A8:K8 объединены, по центру: «от {department}» |
| 9 | A9:K9 объединены, по центру: «на приобретение ТМЦ {omtsMonthPhrase(month)}» |
| 11 | шапка таблицы (жирный, перенос текста, по центру, высота ~60) |
| 12… | строки таблицы; B:D и H:J объединены в каждой строке; перенос текста в B и H |
| последняя+3 | C: «{signerTitle}:» , H: signerName |

Все ячейки таблицы (шапка и строки) — тонкая рамка. Шрифт Times New Roman 11. Ширины колонок (символы): A 5, B 22, C 14, D 14, E 10, F 9, G 12, H 12, I 12, J 12, K 14. Количество — число (без формулы), формат General; пустое количество — пустая ячейка. Ориентация печати — книжная, по ширине страницы (`fitToWidth: 1`).

## Review Focus

- Дефисы внутри наименования («Направляющая Т-24/29-120 Албес - 56 шт», «OSB-3 8 мм - 13 лист») — делится только по последнему разделителю с пробелом, перед числом.
- Пункт без количества, но с числом в названии («Саморезы по дереву 51мм», «Подвес прямой») — не должен разбираться как количество.
- Количество «1 500», «5,2», «0.5»; единица из нескольких слов «пог. м»; без пробела «30шт».
- Текст с `\t`, переводом строки, кавычками, `<`, `&` в названии или примечании — не ломает TSV и HTML для буфера обмена.
- Все пункты выполнены / список пуст — кнопка неактивна; сервер на пустой выборке отвечает 400 с понятным текстом; `localStorage` недоступен (приватный режим) — окно работает со значениями по умолчанию.

---

### Task 1: Разбор пунктов и строки для буфера обмена

**Files:**
- Create: `lib/business/omts-request.ts`
- Test: `lib/business/omts-request.test.ts`

**Interfaces:**
- Consumes: `parseDecimal(raw: string): number | null` из `lib/business/supply-paste.ts`; `csvNumber(value: number): string` из `lib/business/csv.ts`.
- Produces:
  - `interface OmtsRow { name: string; unit: string; quantity: number | null; note: string; parsed: boolean }`
  - `parseOrderItem(title: string, note: string | null): OmtsRow`
  - `omtsMonthPhrase(month: string): string` — `"2026-10"` → `"в октябре 2026 г."`
  - `omtsMonthLabel(month: string): string` — `"2026-10"` → `"октябрь 2026"` (имя файла)
  - `buildOmtsTsv(rows: OmtsRow[]): string`
  - `buildOmtsHtml(rows: OmtsRow[]): string`

- [ ] **Step 1: Write the failing tests** (`describe("parseOrderItem")`, `describe("omtsMonthPhrase")`, `describe("buildOmtsTsv")`, `describe("buildOmtsHtml")`):

```ts
expect(parseOrderItem("Петли дверные левые - 30 шт", null)).toEqual(
  { name: "Петли дверные левые", unit: "шт", quantity: 30, note: "", parsed: true });
expect(parseOrderItem("Направляющая Т-24/29-120 Албес — 56 шт", "Каталог ЦСК")).toMatchObject(
  { name: "Направляющая Т-24/29-120 Албес", unit: "шт", quantity: 56, note: "Каталог ЦСК" });
expect(parseOrderItem("Саморезы по дереву 51мм -1 500 шт", null)).toMatchObject({ quantity: 1500, unit: "шт" });
expect(parseOrderItem("Линолеум Centra 3.5м – 5,2 пог. м", null)).toMatchObject({ name: "Линолеум Centra 3.5м", quantity: 5.2, unit: "пог. м" });
expect(parseOrderItem("Петли - 30шт", null)).toMatchObject({ quantity: 30, unit: "шт" });
expect(parseOrderItem("Саморезы по дереву 51мм", null)).toEqual(
  { name: "Саморезы по дереву 51мм", unit: "", quantity: null, note: "", parsed: false });
expect(parseOrderItem("OSB-3 8 мм", null).parsed).toBe(false);
expect(parseOrderItem("  Пена монтажная  ", "  ").note).toBe("");
expect(omtsMonthPhrase("2026-10")).toBe("в октябре 2026 г.");
expect(omtsMonthPhrase("2027-05")).toBe("в мае 2027 г.");
expect(omtsMonthLabel("2026-03")).toBe("март 2026");
// TSV раскладывается по колонкам A–K шаблона: №, наименование, (C), (D), ГОСТ, ед., кол-во, требования, (I), (J), причина
expect(buildOmtsTsv([row("Петли", "шт", 30, ""), row("Линолеум", "пог. м", 5.2, "Каталог ЦСК")])).toBe(
  "1\tПетли\t\t\t\tшт\t30\t\t\t\t\r\n2\tЛинолеум\t\t\t\tпог. м\t5,2\tКаталог ЦСК\t\t\t\r\n");
expect(buildOmtsTsv([row("А\tБ\nВ", "", null, "")])).toBe("1\tА Б В\t\t\t\t\t\t\t\t\t\r\n");
const html = buildOmtsHtml([row("Болт <M12> & гайка", "шт", 10, "")]);
expect(html).toContain("&lt;M12&gt; &amp; гайка");
expect(html).toContain('colspan="3"');
expect(html.match(/<tr>/g)).toHaveLength(1);
```

(`row(...)` — локальный хелпер теста, собирающий `OmtsRow` с `parsed: true`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/business/omts-request.test.ts`
Expected: FAIL — модуль `./omts-request` не найден.

- [ ] **Step 3: Implement `lib/business/omts-request.ts`**

Разбор — регуляркой по всей строке после `trim()` (жадное наименование → делится по последнему подходящему разделителю):

```ts
const ITEM_RE = /^(.*\S)(?:\s+[-–—]\s*|\s*[-–—]\s+)(\d[\d   ]*(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яЁё].{0,29})$/;
```

Количество — через `parseDecimal`; если `null` или `<= 0` — пункт нераспознан. Единица — `trim()`, как написана. Названия месяцев в предложном (`январе … декабре`) и именительном падеже — массивы в модуле. TSV: ячейки — `replace(/[\t\r\n]+/g, " ").trim()`, количество через `csvNumber`, строки через `\r\n`, 11 ячеек на строку. HTML: `<table>` без шапки, по `<tr>` на строку, ячейки `<td>`; наименование и примечание — `<td colspan="3">`; экранировать `& < > "`. Модуль без серверных и клиентских импортов (используется в обоих местах).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/business/omts-request.test.ts`
Expected: PASS.

### Task 2: Сборка .xlsx и маршрут выгрузки

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm install exceljs@4.4.0`)
- Create: `lib/validation/omts-request.ts`
- Create: `lib/business/omts-workbook.ts`
- Test: `lib/business/omts-workbook.test.ts`
- Create: `app/(app)/[projectId]/board/omts/route.ts`

**Interfaces:**
- Consumes: `OmtsRow`, `parseOrderItem`, `omtsMonthPhrase` (Task 1).
- Produces:
  - `omtsHeaderSchema` (zod-объект): `month` — `/^\d{4}-(0[1-9]|1[0-2])$/` («Выберите месяц»); `organization` — trim, max 200, может быть пустым; `department` — trim, 1..200 («Укажите, от кого заявка»); `signerTitle` — trim, max 100; `signerName` — trim, max 100. Типы `OmtsHeaderInput = z.output<…>`, `OmtsHeaderFormValues = z.input<…>`.
  - `omtsExportSchema = omtsHeaderSchema.extend({ listId: z.uuid() })`, тип `OmtsExportInput`.
  - `buildOmtsWorkbook(header: OmtsHeaderInput, rows: OmtsRow[]): Promise<Buffer>` — в `lib/business/omts-workbook.ts`, только для сервера (`import "server-only"` если пакет уже есть в проекте; иначе комментарий).
  - `POST /{projectId}/board/omts` — тело JSON `OmtsExportInput`; ответ 200 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; 400 `text/plain` с текстом ошибки; 404 — список не найден.

- [ ] **Step 1: Write the failing test** `lib/business/omts-workbook.test.ts` — собрать книгу, прочитать обратно `new ExcelJS.Workbook().xlsx.load(buffer)`:

```ts
const header = { month: "2026-10", organization: "ООО «РК-Гранд»", department: "ремонтно-строительного цеха (РСЦ)", signerTitle: "Начальник цеха", signerName: "Иванов И.И." };
const rows = [parseOrderItem("Петли - 30 шт", "срочно"), parseOrderItem("Пена монтажная", null)];
// лист один, называется «Заявка»
expect(ws.getCell("A7").value).toBe("ЗАЯВКА");
expect(ws.getCell("A8").value).toBe("от ремонтно-строительного цеха (РСЦ)");
expect(ws.getCell("A9").value).toBe("на приобретение ТМЦ в октябре 2026 г.");
expect(ws.getCell("H4").value).toBe("ООО «РК-Гранд»");
expect(ws.getCell("A12").value).toBe(1);
expect(ws.getCell("B12").value).toBe("Петли");
expect(ws.getCell("F12").value).toBe("шт");
expect(ws.getCell("G12").value).toBe(30);
expect(ws.getCell("H12").value).toBe("срочно");
expect(ws.getCell("B13").value).toBe("Пена монтажная");
expect(ws.getCell("G13").value).toBeNull();
expect(ws.getCell("C12").isMerged && ws.getCell("C12").master.address).toBe("B12");
expect(ws.getCell("J13").master.address).toBe("H13");
expect(ws.getCell("C16").value).toBe("Начальник цеха:");
expect(ws.getCell("H16").value).toBe("Иванов И.И.");
expect(ws.getCell("B12").border.left?.style).toBe("thin");
// «=SUM(1)» в названии остаётся строкой, а не формулой
```

Плюс отдельный тест: название `"=SUM(A1)"` → `typeof ws.getCell("B12").value === "string"`; организация пустая → `H4` пустая.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/business/omts-workbook.test.ts`
Expected: FAIL — модуль `./omts-workbook` не найден.

- [ ] **Step 3: Install dependency and implement `buildOmtsWorkbook`** по «Макету файла» выше. Возвращать `Buffer.from(await wb.xlsx.writeBuffer())`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/business/omts-workbook.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement Route Handler `app/(app)/[projectId]/board/omts/route.ts`** — `export async function POST(request: NextRequest, ctx: RouteContext<"/[projectId]/board/omts">)`:
  1. `projectId` не UUID → 404 (как в `reports/export/route.ts`).
  2. `request.json()` в try/catch → `omtsExportSchema.safeParse`; ошибка → 400 «Проверьте поля заявки.».
  3. `createClient()` из `@/lib/supabase/server`; `board_lists` `select("id")` `.eq("id", listId).eq("project_id", projectId).maybeSingle()`; нет строки → 404 «Список не найден.».
  4. `board_items` `select("title, note")` `.eq("list_id", listId).eq("project_id", projectId).eq("is_done", false).order("position").order("created_at")`.
  5. Ошибка запроса → `console.error("omts export:", error)` + 500 «Не удалось собрать заявку. Попробуйте ещё раз.».
  6. Пусто → 400 «В списке нет невыполненных пунктов.».
  7. Ответ: тело — буфер, заголовки `Content-Type` xlsx, `Content-Disposition: attachment; filename="omts-request-{month}.xlsx"`, `Cache-Control: private, no-store`.

  Если `next build` ругается на бандлинг `exceljs` — добавить его в `serverExternalPackages` в `next.config.ts` (сначала проверить, что именно предлагает документация Next 16 в `node_modules/next/dist/docs/`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: без ошибок.

### Task 3: Окно «Заявка в ОМТС» на доске

**Files:**
- Modify: `app/(app)/[projectId]/board/panel.tsx` — `PanelHeader` получает необязательный `action?: React.ReactNode`, выводится справа (`ml-auto`; если есть и `count`, и `action` — `count` перед `action`).
- Modify: `app/(app)/[projectId]/board/board-list.tsx` — кнопка в шапке и окно.
- Create: `app/(app)/[projectId]/board/omts-dialog.tsx`

**Interfaces:**
- Consumes: `parseOrderItem`, `buildOmtsTsv`, `buildOmtsHtml`, `omtsMonthLabel` (Task 1); `omtsHeaderSchema`, `OmtsHeaderInput`, `OmtsHeaderFormValues` (Task 2); `POST /{projectId}/board/omts` (Task 2); `SupplyDialog`, `FieldError` из `../supply/supply-dialog`; `BoardItem` из `./board-item-row`.
- Produces: `OmtsDialog({ projectId, listId, items, today, open, onOpenChange }: { projectId: string; listId: string; items: BoardItem[]; today: string; open: boolean; onOpenChange: (open: boolean) => void })`.

- [ ] **Step 1: Кнопка в `BoardList`.** Из `presentation` вынести признак списка заказа: `isSystem && /материал/i.test(name)`. Только для него в `PanelHeader` передаётся `action` — `Button variant="ghost" size="sm"` с иконкой `FileSpreadsheetIcon` (lucide) и текстом «Заявка в ОМТС»; `disabled`, когда невыполненных пунктов нет. Кнопка видна и без права правки (`canEdit`) — это чтение. Окно монтируется только когда открыто.

- [ ] **Step 2: `OmtsDialog`.** `SupplyDialog` с заголовком «Заявка в ОМТС». Форма RHF + `zodResolver(omtsHeaderSchema)`:
  - «Месяц» — `<Input type="month">`, по умолчанию `today.slice(0, 7)`;
  - «Организация» (placeholder «ООО «…»»), «От кого» (по умолчанию «ремонтно-строительного цеха (РСЦ)», подпись под полем: «В файле: „от …“»), «Должность подписанта» (по умолчанию «Начальник цеха»), «ФИО подписанта».
  - Значения полей кроме месяца берутся из `localStorage["repair-planner:omts-header"]` (JSON) и сохраняются туда после успешной выгрузки/копирования; чтение и запись в `try/catch`, при ошибке — значения по умолчанию.
  - Сводка над кнопками: «В заявку попадут N пунктов.»; если есть `parsed: false` — «Без количества (заполните в файле): …» перечислением названий через запятую.
  - «Скачать файл» (основная): `fetch` POST JSON на `/${projectId}/board/omts`; не `ok` → `toast.error(await res.text() || "Не удалось собрать заявку. Попробуйте ещё раз.")`; иначе blob → временная ссылка `a.download = \`Заявка ТМЦ ${omtsMonthLabel(month)}.xlsx\``, `URL.revokeObjectURL` после клика, `toast.success("Файл заявки скачан.")`.
  - «Скопировать строки» (`variant="outline"`): строки считаются на клиенте из `items.filter(i => !i.is_done)` через `parseOrderItem`; `navigator.clipboard.write([new ClipboardItem({ "text/plain": Blob(tsv), "text/html": Blob(html) })])`, при отсутствии `ClipboardItem` или ошибке — `navigator.clipboard.writeText(tsv)`; затем `toast.success("Строки скопированы — вставьте их в первую строку таблицы заявки.")`; ошибка — `toast.error("Не удалось скопировать. Попробуйте ещё раз.")`.
  - Пока идёт выгрузка — кнопки `disabled`, текст «Собираю…».

- [ ] **Step 3: Lint и typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: без ошибок.

### Task 4: Документация и общая проверка

**Files:**
- Modify: `docs/product-requirements.md` — в разделе о дополнительных списках: кнопка «Заявка в ОМТС», правило разбора пункта, что попадает в заявку.
- Modify: `docs/architecture.md` — Route Handler `board/omts`, `exceljs` только на сервере, почему .xlsx, а не .xls.

- [ ] **Step 1: Обновить документацию** (коротко, в стиле существующих разделов).
- [ ] **Step 2: Полная проверка**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: все тесты зелёные, lint и tsc без ошибок, build успешен.
