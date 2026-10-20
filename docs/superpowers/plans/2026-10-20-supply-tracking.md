# Снабжение: заказ и поставка ТМЦ — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Страница `/[projectId]/supply` — заявки на ТМЦ со счетами, оплатой, поставками по УПД и оприходованием на остаток.

**Architecture:** Миграция `0030` — 6 таблиц `supply_*` с RLS через `project_access`/`project_can_edit`, целостность составными FK, 4 RPC (3 `security invoker` для атомарного создания со строками, 1 `security definer` для прихода). Статусы, разбор вставки из Excel и подбор позиций — чистые функции в `lib/business/` с vitest. UI — Server Component загружает всё одним вложенным запросом, интерактив — Client Components с диалогами base-ui и формами RHF + Zod; изменения — server actions.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL, RLS, pgTAP), TypeScript, Tailwind, `@base-ui/react` Dialog, React Hook Form, Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-supply-tracking-design.md` (дальше — «спека», ссылки вида §4.2).

## Global Constraints

- Ответы, тексты UI, комментарии — на русском; стиль комментариев как в соседнем коде.
- Next 16 отличается от обучающих данных: перед Next-специфичным кодом читать `node_modules/next/dist/docs/`.
- Новых зависимостей не добавлять (Dialog — `@base-ui/react/dialog`, как в `tasks/[taskId]/task-attachments.tsx`).
- Никогда `supabase db reset`. Миграция локально: `supabase migration up --local`. Prod `db push` и `git push` делает пользователь.
- Работа в ветке `feature/supply-tracking` (создать от `main` перед Task 1, согласовав с пользователем — папка общая с другими сессиями). Коммит после каждой задачи, без push. Не коммитить `.claude/`, `HANDOFF*.md`, `docker-compose.yml`.
- Числа количества — `numeric(14,3)`, верхняя граница в Zod `MAX_QUANTITY = 99_999_999_999` (как в `lib/validation/reference-data.ts`).
- Ошибки пользователю — только понятные тексты (`lib/errors.ts`), технические детали — `console.error` на сервере.
- «Сегодня» — `todayInTimezone(project.timezone ?? "Europe/Moscow")` из `lib/business/dates.ts`.
- Роль «просмотр» (`canEditProject(role) === false`) не видит кнопок изменения; каждое действие начинается с `requireProjectEdit(projectId)`.
- Проверки: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint .`, `npm test`, `supabase test db`, `npm run build`.

## Review Focus

1. **Вставка целого блока из Excel с шапкой и подписью** («№ / Наименование / …», «Начальник цеха: Минигулов А.Р.») — эти строки должны попасть в предпросмотр как «не распознано» и не сохраниться. Тест — Task 4.
2. **Ячейки Excel с переносом строки** (Excel кладёт их в кавычки: `"Наименование,\nобозначение"`) — одна ячейка, перенос → пробел, строка не рвётся. Тест — Task 4.
3. **Десятичная запятая в полях форм** (мастер вводит «5,2», «1 500») — принимается как 5.2 / 1500, а не «Введите число». Тест — Task 6.
4. **Остаток к поставке у перепоставленной строки** (привезли 15 при 13) — по умолчанию 0, не −2. Тест — Task 3.
5. **Заявка без позиций или со всеми снятыми** — статус `active`, не «привезена целиком». Тест — Task 3.

---

### Task 1: Таблицы снабжения и RLS (миграция 0030, часть 1)

**Files:**
- Create: `supabase/migrations/0030_supply_tracking.sql`
- Create: `supabase/tests/database/supply-tracking.test.sql`

**Interfaces:**
- Produces: таблицы `supply_requests`, `supply_request_items`, `supply_invoices`, `supply_invoice_lines`, `supply_deliveries`, `supply_delivery_lines`; колонка `material_movements.supply_delivery_line_id`. Колонки, типы, checks, уникальности, индексы, колоночные `grant update` — ровно по спеке §4.1–4.7. Имена FK (нужны для подсказок PostgREST и `lib/errors.ts`):
  `supply_request_items_request_fk`, `supply_request_items_material_fk`, `supply_invoices_request_fk`, `supply_invoice_lines_invoice_fk`, `supply_invoice_lines_item_fk`, `supply_invoice_lines_request_fk`, `supply_deliveries_invoice_fk`, `supply_delivery_lines_delivery_fk`, `supply_delivery_lines_invoice_line_fk`, `supply_delivery_lines_invoice_fk`, `material_movements_supply_line_fk` (`on delete no action`).

- [ ] **Step 1: Написать pgTAP-тест структуры и RLS**

Шаблон фикстур — `supabase/tests/database/project-archive-delete.test.sql` (вставка как postgres, затем `set_config('request.jwt.claim.sub', …)` + `set role authenticated`). Фикстуры: A — владелец PA, B — владелец PB, V — `viewer` в PA, M — `member` в PA; в PA и PB по заявке, позиции, счёту, строке счёта, поставке, строке поставки; материал в PA и в PB. Тесты (описания — как ниже):
- `has_table` ×6, `has_column('public','material_movements','supply_delivery_line_id')`;
- `B sees no supply rows of PA` — для каждой из 6 таблиц `count(*) = 0` по `project_id = PA`;
- `B cannot insert supply_request into PA` — `throws_ok` с `42501`;
- `B update/delete on PA invoice affects 0 rows`;
- `viewer reads PA supply rows` (count > 0), `viewer cannot insert item` (`42501`), `viewer update of invoice affects 0 rows`;
- `member can insert item and mark invoice paid`;
- `project_id is not updatable` — `throws_ok` `update supply_requests set project_id = …` → `42501`;
- `invoice line cannot link to item of another request` — вставка строки счёта заявки R1 с `request_item_id` позиции заявки R2 → `23503`;
- `delivery line cannot reference line of another invoice` → `23503`;
- `deleting item turns its invoice lines into off-request` — `request_item_id is null` после удаления;
- `receipt link requires kind receipt` — вставка (как postgres) движения `adjustment` с `supply_delivery_line_id` → `23514`;
- `received delivery line cannot be deleted` — (как postgres) вставить движение `receipt` со ссылкой, затем под A `delete` строки поставки → `23503`; то же для её счёта и заявки;
- `owner deletes project with received supply` — архивировать PB (как postgres: `archived_at = now()`), вставить там оприходованную строку, под B `delete from projects` → 1 строка.

- [ ] **Step 2: Запустить — тест падает**

Run: `supabase test db`
Expected: FAIL в `supply-tracking.test.sql` (таблиц нет), остальные файлы PASS.

- [ ] **Step 3: Написать DDL таблиц, policies, grants, индексы, `set_updated_at`-триггеры в `0030_supply_tracking.sql`**

Policies — по шаблону `task_queues` в `0018` (select — `project_access(project_id) is not null`, insert/update/delete — `project_can_edit(project_id)`); `revoke update … from authenticated, anon` + `grant update (<колонки из спеки>)`. Шапка-комментарий со ссылкой на спеку.

- [ ] **Step 4: Применить и прогнать**

Run: `supabase migration up --local && supabase test db`
Expected: все тесты PASS (прежние 346 + новые).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0030_supply_tracking.sql supabase/tests/database/supply-tracking.test.sql
git commit -m "feat(supply): таблицы снабжения с RLS"
```

### Task 2: RPC снабжения (миграция 0030, часть 2) и типы

**Files:**
- Modify: `supabase/migrations/0030_supply_tracking.sql` (дописать в конец; миграция ещё не на проде)
- Modify: `supabase/tests/database/supply-tracking.test.sql`
- Modify: `lib/types/database.ts` (регенерация)

**Interfaces:**
- Consumes: таблицы Task 1.
- Produces (сигнатуры и коды — спека §4.8):
  - `create_supply_request(p_project_id uuid, p_number text, p_request_date date, p_description text, p_items jsonb) returns uuid` — `security invoker`; элементы `{line_no int, name text, unit text, quantity numeric, note text}`;
  - `create_supply_invoice(p_request_id uuid, p_number text, p_invoice_date date, p_supplier text, p_amount numeric, p_paid_on date, p_lines jsonb) returns uuid` — `security invoker`; элементы `{line_no, name, unit, quantity, request_item_id uuid|null}`; `project_id`/`request_id` строк берутся из счёта;
  - `create_supply_delivery(p_invoice_id uuid, p_number text, p_delivery_date date, p_lines jsonb) returns uuid` — `security invoker`; элементы `{invoice_line_id uuid, quantity numeric}`; пустой массив → исключение `supply_lines_empty`;
  - `receive_supply_delivery_line(p_delivery_line_id uuid, p_material_id uuid, p_quantity numeric, p_note text default null) returns public.material_movements` — `security definer`; коды `supply_line_not_found`, `access_denied`, `material_not_found`, `invalid_quantity`, `already_received`; примечание по умолчанию `'УПД №' || d.number || ' от ' || to_char(d.delivery_date, 'DD.MM.YYYY') || ', счёт №' || i.number`.
  - Все: `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to authenticated`. Разбор массивов — `jsonb_to_recordset(...) as x(...)`; невидимый по RLS родитель (счёт/заявка) → исключение `supply_parent_not_found`.

- [ ] **Step 1: Дописать pgTAP-тесты RPC**

- `anon cannot execute <fn>` ×4 (`has_function_privilege`);
- `create_supply_request inserts request and 2 items`;
- `create_supply_request is all-or-nothing` — второй элемент с `quantity = 0` → `throws_ok` `23514`, заявка с этим номером не появилась;
- `create_supply_invoice links line to item` и `create_supply_invoice rejects item of other request` → `23503`;
- `create_supply_invoice on foreign request` (под B, заявка PA) → `supply_parent_not_found`;
- `create_supply_delivery with empty lines` → `supply_lines_empty`;
- `create_supply_delivery inserts lines`;
- `receive: balance grows by p_quantity`, `receive: movement is receipt linked to line with default note 'УПД №84009 от 16.10.2026, счёт №89598'`;
- `receive twice` → `already_received`;
- `receive into material of other project` → `material_not_found`;
- `receive by viewer` → `access_denied`; `receive by B` → `supply_line_not_found`; `receive 0` → `invalid_quantity`.

- [ ] **Step 2: Запустить — падает**

Run: `supabase test db` — Expected: FAIL (функций нет).

- [ ] **Step 3: Реализовать 4 функции в конце `0030_supply_tracking.sql`**

`receive_supply_delivery_line` — порядок проверок строго по спеке §4.8 п.4 (доступ → права → материал того же проекта → количество → `for update` + проверка существующего движения), установка `repair_planner.balance_update`, как в `0010`.

- [ ] **Step 4: Применить новую версию функций и прогнать**

Run: `docker exec -i supabase_db_repair_planner psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/0030_supply_tracking.sql` — DDL Task 1 идемпотентна (`if not exists`, `drop policy if exists`, `create or replace`), поэтому повторное применение безопасно; затем `supabase test db`.
Expected: всё PASS. Если повтор DDL падает (например, `add constraint` без проверки существования) — сделать его идемпотентным (`drop constraint if exists` перед `add`).

- [ ] **Step 5: Регенерировать типы**

Run: `supabase gen types typescript --local > lib/types/database.ts && ./node_modules/.bin/tsc --noEmit`
Expected: tsc без ошибок; в `database.ts` есть `supply_requests` и `receive_supply_delivery_line`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0030_supply_tracking.sql supabase/tests/database/supply-tracking.test.sql lib/types/database.ts
git commit -m "feat(supply): RPC создания документов и оприходования"
```

### Task 3: Модель представления и статусы

**Files:**
- Create: `lib/types/supply.ts`
- Create: `lib/business/supply-status.ts`
- Test: `lib/business/supply-status.test.ts`

**Interfaces:**
- Produces (`lib/types/supply.ts`):
  ```ts
  export interface SupplyItemView { id: string; lineNo: number; name: string; unit: string; quantity: number; note: string | null; materialId: string | null; cancelled: boolean }
  export interface SupplyDeliveryLineView { id: string; deliveryId: string; quantity: number; received: boolean }
  export interface SupplyInvoiceLineView { id: string; invoiceId: string; requestItemId: string | null; lineNo: number; name: string; unit: string; quantity: number; deliveries: SupplyDeliveryLineView[] }
  export interface SupplyInvoiceView { id: string; number: string; invoiceDate: string; supplier: string; amount: number | null; paidOn: string | null; lines: SupplyInvoiceLineView[] }
  export interface SupplyDeliveryView { id: string; invoiceId: string; number: string; deliveryDate: string }
  export interface SupplyRequestView { id: string; number: string; requestDate: string; description: string | null; items: SupplyItemView[]; invoices: SupplyInvoiceView[]; deliveries: SupplyDeliveryView[] }
  ```
- Produces (`lib/business/supply-status.ts`):
  ```ts
  export type SupplyLineState = "none" | "partial" | "full";
  export type SupplyItemStatus = "cancelled" | "no_invoice" | "delivered" | "partial" | "paid" | "unpaid";
  export interface SupplyLineProgress { state: SupplyLineState; delivered: number; over: boolean }
  export interface SupplyRequestSummary {
    status: "active" | "delivered";
    total: number; invoiced: number; paid: number; delivered: number; // по неснятым позициям
    items: Record<string, SupplyItemStatus>;
    lines: Record<string, SupplyLineProgress>;
  }
  export function lineProgress(line: SupplyInvoiceLineView): SupplyLineProgress;
  export function remainingToDeliver(line: SupplyInvoiceLineView): number; // max(0, quantity − delivered)
  export function summarizeRequest(request: SupplyRequestView): SupplyRequestSummary;
  ```
  Правила — спека §5 (порядок статусов позиции; `paid` в счётчике — позиции со статусом `paid`/`partial`/`delivered`, у которых все счета привязанных строк оплачены; `invoiced` — неснятые с ≥ 1 строкой).

- [ ] **Step 1: Написать тесты** (фабрика фикстур в файле теста)
  - `lineProgress`: 0 → `none`; 8 из 13 (две поставки 5+3) → `partial`, delivered 8; 13 → `full`, over false; 15 → `full`, over true;
  - `remainingToDeliver`: 13 − 8 = 5; перепоставка 15 из 13 → 0 (Review Focus 4);
  - статусы позиции: снятая с привязанной строкой → `cancelled`; без строк → `no_invoice`; строка в неоплаченном счёте → `unpaid`; в оплаченном → `paid`; частично привезена (даже в неоплаченном счёте) → `partial`; две строки (1 упак + 5 шт), обе `full` → `delivered`, одна `full` другая `none` → `partial`;
  - заявка: все неснятые `delivered` + одна снятая → `delivered`; пустая заявка → `active`; все снятые → `active` (Review Focus 5); строка «вне заявки» не влияет на статус и счётчики;
  - счётчики на заявке из 4 позиций (no_invoice, unpaid, paid, delivered) → `{ total: 4, invoiced: 3, paid: 2, delivered: 1 }`.

- [ ] **Step 2: Run** `npx vitest run lib/business/supply-status.test.ts` — Expected: FAIL (модуля нет).
- [ ] **Step 3: Реализовать** типы и функции.
- [ ] **Step 4: Run** тот же — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/types/supply.ts lib/business/supply-status.ts lib/business/supply-status.test.ts && git commit -m "feat(supply): статусы позиций и заявок"`

### Task 4: Разбор вставки из Excel

**Files:**
- Create: `lib/business/supply-paste.ts`
- Test: `lib/business/supply-paste.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PastedRow { lineNo: number | null; name: string; unit: string; quantity: number | null; note: string; valid: boolean; raw: string }
  export function parseDecimal(raw: string): number | null; // "5,2"→5.2, "1 500"→1500 (пробел/NBSP/узкий пробел), "18.2"→18.2, "abc"/""→null
  export function splitTsv(text: string): string[][];        // строки по \n (\r\n), ячейки по \t, кавычки Excel: "…" с "" внутри и переносами
  export function parsePastedRows(text: string): PastedRow[]; // пустые строки отброшены; valid = name !== "" && quantity > 0
  ```
- Алгоритм строки (тесты его не определяют полностью): ячейки trim; перенос внутри ячейки → пробел;
  1) `lineNo` — первая ячейка, если она целое число и непустых ячеек ≥ 4;
  2) `quantity` — последняя ячейка (кроме ячейки `lineNo`), которую `parseDecimal` разбирает;
  3) `name` — самая длинная непустая ячейка, которую `parseDecimal` не разбирает;
  4) `unit` — ближайшая непустая не-числовая ячейка перед `quantity`, если это не `name`, иначе ближайшая после `quantity`; иначе `""`;
  5) `note` — остальные непустые не-числовые ячейки после `quantity` (кроме `unit`), через `"; "`.

- [ ] **Step 1: Написать тесты**
  - `parseDecimal`: `"5,2"`→5.2, `"1 500"`→1500, `"1 500"`→1500, `"18.2"`→18.2, `"0"`→0, `""`→null, `"шт"`→null;
  - строка заявки `"1\tСаморезы по дереву 51мм\t\tшт\t1500\t"` → `{ lineNo: 1, name: "Саморезы по дереву 51мм", unit: "шт", quantity: 1500, note: "", valid: true }`;
  - `"4\tЛинолеум коммерческий Centra Botticelli T93 3.5м\t\tпог. м \t5,2\tКаталог ЦСК"` → unit `"пог. м"`, quantity 5.2, note `"Каталог ЦСК"`;
  - строка счёта без № `"Саморез по дереву 3,8х51 (500шт) в ведре\t3\tупак"` → `{ lineNo: null, name: "Саморез по дереву 3,8х51 (500шт) в ведре", unit: "упак", quantity: 3 }`;
  - кавычки с переносом `'6\t"Плинтус напольный\nКлассик 55"\tшт\t17'` → одна строка, name `"Плинтус напольный Классик 55"` (Review Focus 2);
  - шапка `"№\tНаименование\tЕд.\tКол-во"` и подпись `"\tНачальник цеха:\tМинигулов А.Р."` → `valid: false` (Review Focus 1);
  - пустые строки и `"\t\t"` отбрасываются; `\r\n` разбирается как `\n`.
- [ ] **Step 2: Run** `npx vitest run lib/business/supply-paste.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(supply): разбор вставки из Excel"` (оба файла).

### Task 5: Подбор позиции заявки к строке счёта

**Files:**
- Create: `lib/business/supply-match.ts`
- Test: `lib/business/supply-match.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SUPPLY_MATCH_THRESHOLD = 0.35;
  export function matchTokens(name: string): Set<string>;
  export function matchScore(itemName: string, lineName: string): number; // доля токенов позиции, найденных в строке, 0..1
  export function suggestItemId(lineName: string, items: Pick<SupplyItemView, "id" | "name" | "cancelled" | "lineNo">[]): string | null;
  ```
- Токенизация (уточняет спеку §6.4 — «доля слов позиции», не Жаккар: с Жаккаром «Саморез … 3,8х35 (1000шт) в ведре» не находит «Саморезы по дереву 35мм»): до нижнего регистра заменить кириллические двойники латиницей (`АВЕКМНОРСТХ`→`ABEKMHOPCTX`, `аеорсух`→`aeopcyx`, `і`→`i`); нижний регистр; `ё`→`е`; всё, кроме букв и цифр, → пробел; разделить границы буква/цифра («8х35» → «8 х 35», «35мм» → «35 мм»); числа оставлять любой длины, слова длиной ≥ 2 обрезать до первых 5 символов. Лучший — максимум счёта ≥ порога, при равенстве — меньший `lineNo`; снятые не рассматриваются. Поправить формулировку в спеке §6.4 тем же коммитом.

- [ ] **Step 1: Написать тесты** (позиции — из примера заявки: №1 «Саморезы по дереву 51мм», №3 «Саморезы по дереву 35мм», №4 «Линолеум коммерческий Centra Botticelli T93 3.5м», №5 «… T93 4м», №24 «Профиль внешний угол Alprofi ПК 03-9.2700.042л 270 см алюминий анодированный цвет шампань», №15 «Подвес прямой»):
  - «Саморез по дереву 3,8х35 (1000шт) в ведре» → №3; «Саморез по дереву 3,8х51 (500шт) в ведре» → №1;
  - «Линолеум коммерческий Centra Botticelli Т93 3.5м» (кириллическая «Т») → №4; «… Т93 4м» → №5;
  - «Профиль внешний угол Alprofі ПК 02.2700.15 270 см алюминий окрашенный цвет черный» → №24;
  - «Подвес прямой 60х27 0,7 мм» → №15;
  - «Гвозди строительные 4,0х120 (25кг)» → `null`;
  - снятая №3 не предлагается: «Саморез … 3,8х35 …» → №1 (счёт выше порога) — проверить, что не №3;
  - `matchScore("Подвес прямой", "Подвес прямой 60х27 0,7 мм") === 1`.
- [ ] **Step 2: Run** `npx vitest run lib/business/supply-match.test.ts` — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS. Если какой-то пример не проходит при пороге 0,35 — менять нормализацию, не порог и не тест; изменение порога согласовать.
- [ ] **Step 5: Commit** `git commit -m "feat(supply): подбор позиции заявки к строке счёта"` (+ правка спеки).

### Task 6: Zod-схемы и сообщения об ошибках

**Files:**
- Create: `lib/validation/supply.ts`, Test: `lib/validation/supply.test.ts`
- Modify: `lib/validation/reference-data.ts` (экспортировать `MAX_QUANTITY`)
- Modify: `lib/errors.ts`, Test: `lib/errors.test.ts`

**Interfaces:**
- Produces (`lib/validation/supply.ts`; для каждой схемы — пара типов `XInput = z.output`, `XFormValues = z.input`, как в `reference-data.ts`):
  - `decimalNumber()` — preprocess: пустая строка → undefined; строка → `parseDecimal` из Task 4 (запятая, пробелы); число как есть; затем `z.number({ error: "Введите число" })`;
  - `positiveQuantity = decimalNumber().pipe(z.number().gt(0, "Количество должно быть больше нуля").max(MAX_QUANTITY, "Слишком большое число"))`;
  - `isoDate` — `YYYY-MM-DD`, сообщение «Укажите дату»;
  - `supplyRequestSchema { number (trim 1–60), requestDate: isoDate, description (trim ≤500, optional → "" ) }`;
  - `supplyItemSchema { lineNo: int ≥1, name (1–300), unit (1–30), quantity: positiveQuantity, note (≤300, optional) }`, `supplyItemEditSchema = supplyItemSchema.extend({ materialId: z.uuid().nullable() })`;
  - `supplyItemsSchema = z.array(supplyItemSchema).min(1).max(500)`;
  - `supplyInvoiceSchema { number (1–60), invoiceDate: isoDate, supplier (1–200), amount: decimalNumber ≥0 optional/nullable, paidOn: isoDate nullable }`;
  - `supplyInvoiceLineSchema { lineNo, name, unit, quantity, requestItemId: z.uuid().nullable() }`, `supplyInvoiceLinesSchema` (1–500);
  - `supplyDeliverySchema { number (1–60), deliveryDate: isoDate, lines: z.array({ invoiceLineId: z.uuid(), quantity: positiveQuantity }).min(1, "Отметьте хотя бы одну строку") }`;
  - `supplyReceiveSchema { materialId: z.uuid({ error: "Выберите материал" }), quantity: positiveQuantity, note (≤500 optional) }`.
- Produces (`lib/errors.ts`): `export function mapSupplyError(error: { code?: string; message?: string } | null | undefined): string` — коды и тексты спеки §7 плюс `supply_lines_empty` → «Добавьте хотя бы одну строку.», `supply_parent_not_found` → «Документ не найден. Обновите страницу.»; `23503` + сообщение содержит `material_movements_supply_line_fk` → текст «Нельзя удалить: …»; `23503` + `supply_invoice_lines_item_fk` → «Позиция не найдена в этой заявке. Обновите страницу.»; иначе «Не удалось сохранить. Попробуйте ещё раз.».

- [ ] **Step 1: Тесты**: `positiveQuantity` принимает `"5,2"`→5.2 и `"1 500"`→1500 (Review Focus 3), отвергает `""`, `"0"`, `"abc"`, `"1e12"`; `supplyRequestSchema` отвергает номер из пробелов и дату `"20.10.2026"`; `supplyDeliverySchema` с `lines: []` → ошибка «Отметьте хотя бы одну строку»; `mapSupplyError` на каждый код и оба варианта `23503` и неизвестную ошибку.
- [ ] **Step 2: Run** `npx vitest run lib/validation/supply.test.ts lib/errors.test.ts` — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS; `npm test` — всё PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(supply): схемы валидации и тексты ошибок"`.

### Task 7: Страница «Снабжение» — загрузка, просмотр, поиск

**Files:**
- Create: `app/(app)/[projectId]/supply/page.tsx`, `loading.tsx`, `supply-data.ts`, `supply-board.tsx`, `request-block.tsx`, `request-table.tsx`
- Create: `lib/business/supply-filter.ts`, Test: `lib/business/supply-filter.test.ts`
- Modify: `components/common/project-nav.tsx` (пункт `{ segment: "supply", label: "Снабжение" }` после «Материалы»)

**Interfaces:**
- Consumes: типы Task 3, `summarizeRequest`, `lineProgress` (Task 3).
- Produces:
  - `supply-data.ts`: `loadSupplyRequests(projectId: string): Promise<SupplyRequestView[] | null>` — один `select` из `supply_requests` с вложенными `supply_request_items`, `supply_invoices(… supply_invoice_lines(… supply_delivery_lines(id, delivery_id, quantity, material_movements(id))))`, `supply_deliveries` через счета; при неоднозначности связи — подсказка `!<имя FK>` из Task 1. `received = material_movements.length > 0`. `null` — ошибка запроса (логируется). Сортировки — спека §6.1. `loadSupplyMaterials(projectId): Promise<{ id: string; name: string; unit: string }[]>` — активные материалы по имени.
  - `supply-filter.ts`: `filterSupplyRequests(requests: SupplyRequestView[], opts: { query: string; onlyActive: boolean }): SupplyRequestView[]` — поиск по полям спеки §6.1, без регистра, `ё`=`е`; `onlyActive` скрывает `summarizeRequest(r).status === "delivered"`.
  - `SupplyBoard` props: `{ projectId: string; requests: SupplyRequestView[]; materials: {id,name,unit}[]; canEdit: boolean; today: string }` — состояние поиска/фильтра и раскрытых блоков (по умолчанию раскрыты активные; найденные поиском — раскрыты).
  - `RequestBlock` props: `{ projectId; request: SupplyRequestView; summary: SupplyRequestSummary; open: boolean; onToggle(): void; canEdit; materials; today }`. Кнопки действий в этой задаче не рендерятся — их добавляют Task 8–10 в отведённые места: меню заявки, строка «Счета», «Поставки», панель `[+ Позиции] [+ Счёт] [+ Поставка]`.
  - `RequestTable` — таблица спеки §6.1: `rowSpan` левой части, цвет строки по статусу (зелёный `delivered`, светло-зелёный `partial`, жёлтая метка `no_invoice`, серый зачёркнутый `cancelled`, красная метка «не оплачено»), «вне заявки» — внизу, горизонтальная прокрутка внутри блока. Токены цвета — из `app/globals.css` (существующие status-токены), без новых hex.
- Пустое состояние: «Заявок на ТМЦ пока нет» (`components/common/empty-state.tsx`).

- [ ] **Step 1: Тесты `supply-filter`**: поиск «ЦСК» находит по поставщику; «ведре» — по строке счёта; «кабинет» — по описанию; «ЁЛКА» находит «елка»; `onlyActive` скрывает привезённую.
- [ ] **Step 2: Run** `npx vitest run lib/business/supply-filter.test.ts` — FAIL; реализовать; Run — PASS.
- [ ] **Step 3: Реализовать страницу и компоненты.** `page.tsx` — Server Component: `getProjectRole`, `projects.timezone`, `loadSupplyRequests`, `loadSupplyMaterials`; при `null` — сообщение «Не удалось загрузить заявки на ТМЦ. Обновите страницу.».
- [ ] **Step 4: Проверка**: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && npm test` — чисто. Сид одной заявки через `docker exec … psql` (рецепт HANDOFF.md), страница открывается в браузере, таблица соответствует макету §6.1, ошибок в консоли нет.
- [ ] **Step 5: Commit** `git commit -m "feat(supply): страница «Снабжение» с таблицей заявок"`.

### Task 8: Заявка и позиции — создание, вставка, правка

**Files:**
- Create: `app/(app)/[projectId]/supply/actions.ts`, `supply-dialog.tsx`, `paste-rows.tsx`, `request-dialog.tsx`, `item-dialog.tsx`
- Modify: `supply-board.tsx`, `request-block.tsx`, `request-table.tsx`

**Interfaces:**
- Consumes: схемы и `mapSupplyError` (Task 6), `parsePastedRows` (Task 4), RPC `create_supply_request` (Task 2).
- Produces (`actions.ts`, `"use server"`, каждый начинается с `requireProjectEdit`, Zod `safeParse`, `revalidatePath(\`/${projectId}/supply\`)`, ошибки через `mapSupplyError`, 0 затронутых строк → «Запись не найдена. Обновите страницу.»):
  - `createSupplyRequestAction(projectId: string, input: SupplyRequestInput, items: SupplyItemInput[]): Promise<ActionResult>`
  - `updateSupplyRequestAction(projectId, requestId, input: SupplyRequestInput)`
  - `deleteSupplyRequestAction(projectId, requestId)`
  - `addSupplyItemsAction(projectId, requestId, items: SupplyItemInput[])` — `lineNo` у строк без номера = `max(line_no) + 1…`
  - `updateSupplyItemAction(projectId, itemId, input: SupplyItemEditInput)`
  - `setSupplyItemCancelledAction(projectId, itemId, cancelled: boolean)` — `cancelled_at = now()` / `null`
  - `deleteSupplyItemAction(projectId, itemId)`
- Produces (UI):
  - `SupplyDialog({ open, onOpenChange, title, children })` — обёртка над `@base-ui/react/dialog` в стиле приложения (светлая карточка, не фото-лайтбокс), прокрутка содержимого, ширина до `max-w-3xl`, на мобильном — на всю ширину.
  - `PasteRows({ mode: "items" | "invoice", requestItems?: SupplyItemView[], value: EditableRow[], onChange })` — textarea «Вставьте строки из Excel» + редактируемая таблица предпросмотра (наименование, ед., кол-во, примечание / позиция заявки), удаление строк, нераспознанные подсвечены; подсказка про PDF (спека §6.3). Тип `EditableRow` экспортируется отсюда: `{ key: string; lineNo: number | null; name: string; unit: string; quantity: string; note: string; requestItemId: string | null }`.
  - `RequestDialog` (создание: шапка + `PasteRows mode="items"`, необязательна; правка: только шапка), `ItemDialog` (правка, материал справочника — `NativeSelect` из `components/ui/native-select.tsx` с пунктом «— не выбран —»; «Снять»/«Вернуть»; удалить с `confirm`).

- [ ] **Step 1: Реализовать actions** и подключить: «+ Заявка на ТМЦ» в шапке страницы, меню заявки (изменить/удалить), «+ Позиции», клик по позиции → `ItemDialog`. Только при `canEdit`.
- [ ] **Step 2: Проверка**: tsc, eslint, `npm test` — чисто; в браузере: создать заявку вставкой 10 строк из `ТМЦоктябрь2026г.(кабмех).xls` (через буфер: `navigator.clipboard` недоступен — вставлять текст в textarea через `form_input`), шапку и подпись — удалить из предпросмотра; снять позицию — строка серая; удалить заявку.
- [ ] **Step 3: Commit** `git commit -m "feat(supply): создание заявки на ТМЦ и позиций"`.

### Task 9: Счета — создание с подбором, оплата, правка строк

**Files:**
- Create: `app/(app)/[projectId]/supply/invoice-dialog.tsx`, `invoice-line-dialog.tsx`
- Modify: `actions.ts`, `request-block.tsx`, `request-table.tsx`, `paste-rows.tsx`

**Interfaces:**
- Consumes: `suggestItemId` (Task 5), `create_supply_invoice` (Task 2), `PasteRows mode="invoice"` (Task 8).
- Produces (`actions.ts`):
  - `createSupplyInvoiceAction(projectId, requestId, input: SupplyInvoiceInput, lines: SupplyInvoiceLineInput[])`
  - `updateSupplyInvoiceAction(projectId, invoiceId, input: SupplyInvoiceInput)`
  - `setSupplyInvoicePaidAction(projectId, invoiceId, paidOn: string | null)`
  - `deleteSupplyInvoiceAction(projectId, invoiceId)`
  - `addSupplyInvoiceLinesAction(projectId, invoiceId, lines: SupplyInvoiceLineInput[])`
  - `updateSupplyInvoiceLineAction(projectId, lineId, input: SupplyInvoiceLineInput)`
  - `deleteSupplyInvoiceLineAction(projectId, lineId)`
- В `PasteRows mode="invoice"` у каждой строки `<select>`: «— вне заявки —» + неснятые позиции «№ наименование»; начальное значение — `suggestItemId(row.name, requestItems)`.
- Строка «Счета» в блоке: «№ · дата · поставщик · сумма ₽ · ✓ оплачен ДД.ММ / не оплачен [Оплачен…]», меню ⋯ — изменить, снять оплату, добавить строки, удалить. «Оплачен…» — диалог с датой, по умолчанию `today`.

- [ ] **Step 1: Реализовать** actions, диалоги, подключение.
- [ ] **Step 2: Проверка**: tsc, eslint, `npm test`; в браузере: счёт ЦСК (10 строк) — подбор предложил верные позиции (саморезы 35 → №3), гвозди — «вне заявки» внизу таблицы; «Оплачен…» → метка «✓ 14.10»; правка строки — перепривязка к другой позиции.
- [ ] **Step 3: Commit** `git commit -m "feat(supply): счета, оплата и привязка строк"`.

### Task 10: Поставки и оприходование

**Files:**
- Create: `app/(app)/[projectId]/supply/delivery-dialog.tsx`, `receive-dialog.tsx`
- Modify: `actions.ts`, `request-block.tsx`, `request-table.tsx`

**Interfaces:**
- Consumes: `remainingToDeliver` (Task 3), `create_supply_delivery`, `receive_supply_delivery_line` (Task 2), `supplyDeliverySchema`, `supplyReceiveSchema` (Task 6).
- Produces (`actions.ts`):
  - `createSupplyDeliveryAction(projectId, invoiceId, input: SupplyDeliveryInput)`
  - `updateSupplyDeliveryLineAction(projectId, deliveryLineId, quantity: number)`
  - `deleteSupplyDeliveryLineAction(projectId, deliveryLineId)`, `deleteSupplyDeliveryAction(projectId, deliveryId)`
  - `receiveSupplyDeliveryLineAction(projectId, deliveryLineId, input: SupplyReceiveInput)` — также `revalidatePath(\`/${projectId}/materials\`, "layout")`
  - `createSupplyMaterialAction(projectId, input: { name: string; unit: string }): Promise<{ ok: true; materialId: string } | { ok: false; error: string }>` — схема `materialSchema` с `minimumBalance: 0`; дубль имени → «Материал с таким названием уже есть.»
- `DeliveryDialog`: выбор счёта заявки → № УПД, дата (по умолчанию `today`) → строки счёта с полем «привезено» = `remainingToDeliver`; строки с пустым/0 не отправляются.
- Ячейка «Привезено»: `8 / 13`, список поставок строки «5 · УПД 84009 16.10 [Оприходовать] | ✓ оприходовано», правка/удаление строки поставки, если не оприходована.
- `ReceiveDialog`: `<select>` материала (предвыбран `item.materialId`), кол-во по умолчанию = привезённому, если `unit` совпадает с единицей материала после `toLowerCase().replace(/\.$/, "").trim()`, иначе пусто; подпись «в единицах материала: <ед.>»; ссылка «Создать материал» (имя и ед. строки счёта) → после создания выбран новый.

- [ ] **Step 1: Реализовать** actions, диалоги, подключение.
- [ ] **Step 2: Проверка**: tsc, eslint, `npm test`; в браузере: поставка 8 из 13 → «частично», вторая 5 → строка зелёная; «Оприходовать» → остаток в «Материалах» вырос, у строки «✓ оприходовано», кнопки больше нет; удаление оприходованной поставки → понятная ошибка в toast.
- [ ] **Step 3: Commit** `git commit -m "feat(supply): поставки по УПД и оприходование"`.

### Task 11: Документация и полная проверка

**Files:**
- Modify: `docs/product-requirements.md` (новый раздел «Снабжение»: процесс, правила §2 спеки), `docs/database.md` (6 таблиц, колонка движения, 4 RPC, RLS, миграция 30, итог тестов), `docs/architecture.md` (маршрут `supply`, модули `lib/business/supply-*`), `docs/roadmap.md` (пункты спеки §10, в т.ч. ИИ-разбор §9)
- Modify: `HANDOFF.md` (не коммитится)

- [ ] **Step 1: Обновить docs** по фактическому коду (имена, коды ошибок, число тестов).
- [ ] **Step 2: Полный прогон**: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint .`, `npm test`, `supabase test db`, `npm run build` — всё зелёное, числа тестов записать.
- [ ] **Step 3: Браузерная проверка** по спеке §8 «Браузер» (QA-пользователь `qa-…@example.test`, рецепт HANDOFF.md): сценарий целиком + роль viewer без кнопок + ширина 375 px без горизонтальной прокрутки страницы + нет ошибок консоли/сервера. Затем удалить QA-проекты и пользователей SQL-ом, остановить dev-сервер.
- [ ] **Step 4: Security-проверка**: в `0030` у всех 6 таблиц `enable row level security`; anon не исполняет RPC (pgTAP); `receive_supply_delivery_line` не раскрывает существование чужой строки (один код для «нет» и «нет доступа»).
- [ ] **Step 5: Commit** `git commit -m "docs(supply): требования, БД, архитектура, roadmap"` и отчёт пользователю по CLAUDE.md §38 (миграция `0030` ждёт `supabase db push` от пользователя).
