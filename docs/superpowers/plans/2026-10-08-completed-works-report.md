# Отчёт «Выполненные работы за месяц» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вкладка «Выполненные работы» в «Отчётах»: выполненные за календарный месяц заявки по цехам (дата, название, исполнители, материалы) и CSV-выгрузка.

**Architecture:** SQL-функция `completed_works_report` (security invoker, границы месяца в timezone проекта) отдаёт строки уже с исполнителями и материалами; чистые функции `lib/business/works-report.ts` группируют, фильтруют и строят CSV; серверная загрузка `works-data.ts` общая для страницы и route выгрузки.

**Tech Stack:** Next.js 16 App Router (Server Components), Supabase PostgreSQL + RLS, pgTAP, vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-08-completed-works-report-design.md`

## Global Constraints

- Ответы пользователю и UI — на русском; технические ошибки только в `console.error` (CLAUDE.md §31).
- Только выполненные заявки (`status = 'completed'`), по `completed_at`; отменённые и открытые — нет.
- Месяц — календарный, в timezone проекта, полуинтервал `[1-е число 00:00, 1-е следующего 00:00)`.
- Функция БД: `language sql stable`, `set search_path = ''`, security invoker, `revoke all … from public, anon`, `grant execute … to authenticated`. Новых таблиц/политик нет.
- CSV: BOM, разделитель «;», `\r\n`, защита от формул (ведущие `= + - @ \t \r` → апостроф), экранирование `" ; \r \n`.
- Колонки CSV ровно: `Цех;Дата выполнения;Заявка;Исполнители;Материалы`; дата `дд.мм.гггг` в timezone проекта.
- Строка материалов: «Электрод 2,5 кг; Краска 1 л» (`formatQuantity`, порядок по названию материала).
- Новых npm-зависимостей нет. Новых клиентских компонентов нет.
- Никогда `supabase db reset`. Локально миграции — `supabase migration up --local`.
- Отчёт по расходу материалов (существующий) не меняет поведения; его тесты остаются зелёными без правок ожиданий.

## Review Focus

- Заявка, выполненная ровно в 00:00 первого числа по времени проекта, — в новом месяце, не в старом (тест в Task 1).
- Название заявки или цеха с `=`/`;`/кавычками — CSV не ломается и не исполняет формулу (тест в Task 2).
- Дробный расход и несколько материалов в одной ячейке CSV — ячейка в кавычках, запятая десятичная (тест в Task 2).
- Смена цеха в фильтре на вкладке работ не перекидывает на вкладку расхода (`report` в адресе; проверка в браузере, Task 4).
- Пустой месяц и месяц без доступа к проекту — пустой отчёт и CSV только с заголовком, не 500 (тест в Task 1 + проверка в Task 3).

---

### Task 1: SQL-функция `completed_works_report` (миграция 0025)

**Files:**
- Create: `supabase/migrations/0025_completed_works_report.sql`
- Create: `supabase/tests/database/completed-works-report.test.sql`
- Modify: `lib/types/database.ts` (генерация)

**Interfaces:**
- Produces: RPC `completed_works_report(p_project_id uuid, p_month date)` → строки `{task_id uuid, title text, completed_at timestamptz, category_id uuid|null, category_name text|null, category_sort_order int|null, executor_names text[], materials jsonb}`; `materials` — массив `{name, unit, quantity}` по названию, `[]` без материалов.

- [ ] **Step 1: Написать pgTAP-тест**

`supabase/tests/database/completed-works-report.test.sql`:

```sql
-- Отчёт «Выполненные работы за месяц» (0025): public.completed_works_report.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(11);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A (Europe/Moscow), B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'works-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'works-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'works-viewer-c@example.com');

insert into public.projects (id, owner_id, name, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A', 'Europe/Moscow'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B', 'Europe/Moscow');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

-- «Энергетический» выше в справочнике (sort_order 0), хоть и позже по алфавиту.
insert into public.categories (id, project_id, name, sort_order) values
  ('c3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Механический', 1),
  ('c3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Энергетический', 0);

insert into public.executors (id, project_id, name) values
  ('e3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Петров Пётр'),
  ('e3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Иванов Иван');

insert into public.materials (id, project_id, name, unit, current_balance) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрод', 'кг', 100),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Краска', 'л', 100);

-- W1 23:30 МСК 30.09 — сентябрь; W2 00:00 МСК 01.10 — октябрь (граница);
-- W3 10.09, W4 05.09 (Энергетический), W5 15.09 без цеха — сентябрь.
insert into public.tasks (id, project_id, title, status, completed_at, category_id) values
  ('f3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ремонт насоса', 'completed',
   '2026-09-30 20:30+00', 'c3000000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Замена ворот', 'completed',
   '2026-09-30 21:00+00', 'c3000000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сварка рамы', 'completed',
   '2026-09-10 10:00+00', 'c3000000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Покраска щита', 'completed',
   '2026-09-05 10:00+00', 'c3000000-0000-0000-0000-000000000002'),
  ('f3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Без цеха работа', 'completed',
   '2026-09-15 10:00+00', null),
  ('f3000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Чужая работа', 'completed',
   '2026-09-15 10:00+00', null);

-- Отменённая (дату отмены ставит триггер 0023) и открытая — не попадают.
insert into public.tasks (id, project_id, title, status, category_id) values
  ('f3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Отменённая', 'cancelled',
   'c3000000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Открытая', 'new',
   'c3000000-0000-0000-0000-000000000001');

insert into public.task_executors (task_id, executor_id, project_id) values
  ('f3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.task_materials (project_id, task_id, material_id, quantity) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 2.5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 1);

-- 1-2
select has_function('public', 'completed_works_report', array['uuid', 'date'], 'completed_works_report exists');
select ok(
  not has_function_privilege('anon', 'public.completed_works_report(uuid, date)', 'execute'),
  'anon cannot execute completed_works_report'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Сентябрь: цеха по sort_order, «Без цеха» последним, внутри — по дате
select is(
  array(select title from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01')),
  array['Покраска щита', 'Сварка рамы', 'Ремонт насоса', 'Без цеха работа'],
  'september: categories by sort_order, no category last, works by date'
);

-- 4. День внутри месяца — тот же месяц
select is(
  array(select title from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-17')),
  array['Покраска щита', 'Сварка рамы', 'Ремонт насоса', 'Без цеха работа'],
  'any day of the month means that month'
);

-- 5. 00:00 МСК 01.10 — уже октябрь
select is(
  array(select title from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01')),
  array['Замена ворот'],
  'midnight of the 1st in project timezone belongs to the new month'
);

-- 6. Цех в строке
select row_eq(
  $$ select category_name, category_sort_order from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2026-09-01') where title = 'Покраска щита' $$,
  row('Энергетический'::text, 0),
  'row carries category name and sort order'
);

-- 7. Исполнители — по имени
select is(
  (select executor_names from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01')
    where title = 'Ремонт насоса'),
  array['Иванов Иван', 'Петров Пётр'],
  'executors are sorted by name'
);

-- 8. Материалы — по названию, с количеством
select is(
  (select materials from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01')
    where title = 'Ремонт насоса'),
  '[{"name": "Краска", "unit": "л", "quantity": 1}, {"name": "Электрод", "unit": "кг", "quantity": 2.5}]'::jsonb,
  'materials are sorted by name with quantity'
);

-- 9. Без исполнителей и материалов — пустые массивы
select row_eq(
  $$ select executor_names, materials from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '2026-09-01') where title = 'Сварка рамы' $$,
  row('{}'::text[], '[]'::jsonb),
  'no executors and materials give empty arrays'
);

-- 10. Чужой проект — пусто, не ошибка
select is(
  (select count(*) from public.completed_works_report('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-09-01')),
  0::bigint,
  'foreign project gives an empty report'
);

reset role;

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 11
select is(
  (select count(*) from public.completed_works_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-01')),
  4::bigint,
  'viewer sees the project report'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 2: Запустить — тест падает**

Run: `supabase test db 2>&1 | grep -E "completed-works|Result"`
Expected: FAIL — `function public.completed_works_report(...) does not exist`.

- [ ] **Step 3: Написать миграцию**

`supabase/migrations/0025_completed_works_report.sql`:

```sql
-- Отчёт «Выполненные работы за месяц» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md).
-- Выполненные заявки календарного месяца в timezone проекта с исполнителями и
-- материалами (итог расхода по заявке). security invoker: RLS tasks, categories,
-- task_executors, executors, task_materials, materials действует — нет доступа
-- к проекту, нет строки projects и границ месяца, отчёт пуст.

create or replace function public.completed_works_report(
  p_project_id uuid,
  p_month date
)
returns table (
  task_id uuid,
  title text,
  completed_at timestamptz,
  category_id uuid,
  category_name text,
  category_sort_order int,
  executor_names text[],
  materials jsonb
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('month', p_month)::timestamp at time zone p.timezone) as from_at,
      ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone p.timezone) as to_at
    from public.projects p
    where p.id = p_project_id
  )
  select
    t.id,
    t.title,
    t.completed_at,
    c.id,
    c.name,
    c.sort_order,
    array(
      select e.name
        from public.task_executors te
        join public.executors e on e.id = te.executor_id
        where te.task_id = t.id
        order by e.name
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'unit', m.unit, 'quantity', tm.quantity) order by m.name)
        from public.task_materials tm
        join public.materials m on m.id = tm.material_id
        where tm.task_id = t.id
    ), '[]'::jsonb)
  from bounds b
  join public.tasks t
    on t.project_id = p_project_id
   and t.status = 'completed'
   and t.completed_at >= b.from_at
   and t.completed_at < b.to_at
  left join public.categories c on c.id = t.category_id
  order by c.sort_order nulls last, c.name nulls last, t.completed_at, t.id;
$$;

revoke all on function public.completed_works_report(uuid, date) from public, anon;
grant execute on function public.completed_works_report(uuid, date) to authenticated;
```

- [ ] **Step 4: Применить локально и прогнать тесты**

Run: `supabase migration up --local && supabase test db 2>&1 | grep -E "not ok|Result|Files="`
Expected: `Result: PASS`, всего 287 + 11 = 298.

- [ ] **Step 5: Сгенерировать типы**

Run: `supabase gen types typescript --local > lib/types/database.ts 2>/dev/null && git diff --stat lib/types/database.ts`
Expected: в diff появилась функция `completed_works_report`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0025_completed_works_report.sql supabase/tests/database/completed-works-report.test.sql lib/types/database.ts
git commit -m "feat(reports): RPC completed_works_report (0025)"
```

---

### Task 2: Чистые функции отчёта и общий CSV

**Files:**
- Create: `lib/business/csv.ts`, `lib/business/csv.test.ts`
- Create: `lib/business/works-report.ts`, `lib/business/works-report.test.ts`
- Modify: `lib/business/material-report.ts:109-145` (CSV-хелперы → `csv.ts`)

**Interfaces:**
- Consumes: из `material-report.ts` — `ALL_CATEGORIES`, `NO_CATEGORY`, `NO_CATEGORY_LABEL`, `formatQuantity`; из `dates.ts` — `formatDateNumeric(iso, timezone)`.
- Produces:
  - `csv.ts`: `csvText(value: string): string`, `csvNumber(value: number): string`, `buildCsv(lines: string[][]): string`.
  - `works-report.ts`: типы `WorkMaterial = {name: string; unit: string; quantity: number}`, `WorkRow` (строка RPC), `Work = {taskId; title; completedAt; executorNames: string[]; materials: WorkMaterial[]}`, `WorkGroup = {categoryId: string|null; categoryName: string; works: Work[]}`; функции `groupWorksByCategory(rows: WorkRow[]): WorkGroup[]`, `filterWorkGroups(groups: WorkGroup[], category: string): WorkGroup[]`, `formatMaterials(materials: WorkMaterial[]): string`, `buildWorksCsv(groups: WorkGroup[], timezone: string): string`, `worksReportQuery(month: string, category: string): string`, константа `WORKS_REPORT = "works"`.

- [ ] **Step 1: Тесты общего CSV**

`lib/business/csv.test.ts`:

```ts
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
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run lib/business/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'` / функции не определены.

- [ ] **Step 3: Вынести CSV-хелперы**

`lib/business/csv.ts`:

```ts
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
```

В `lib/business/material-report.ts` удалить локальные `csvCell` и `csvText`, добавить импорт и переписать `buildConsumptionCsv`:

```ts
import { buildCsv, csvNumber, csvText } from "./csv";
```

```ts
/** CSV отчёта по расходу (формат — lib/business/csv.ts). */
export function buildConsumptionCsv(groups: ConsumptionGroup[]): string {
  const lines = [["Цех", "Материал", "Ед. изм.", "Расход"]];

  for (const group of groups) {
    for (const item of group.items) {
      lines.push([csvText(group.categoryName), csvText(item.materialName), csvText(item.unit), csvNumber(item.quantity)]);
    }
  }

  return buildCsv(lines);
}
```

- [ ] **Step 4: Прогнать CSV и отчёт по расходу**

Run: `npx vitest run lib/business/csv.test.ts lib/business/material-report.test.ts`
Expected: PASS, ожидания `material-report.test.ts` не менялись.

- [ ] **Step 5: Тесты отчёта работ**

`lib/business/works-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildWorksCsv,
  filterWorkGroups,
  formatMaterials,
  groupWorksByCategory,
  worksReportQuery,
  type WorkRow,
} from "./works-report";

const row = (over: Partial<WorkRow>): WorkRow => ({
  task_id: "t1",
  title: "Ремонт насоса",
  completed_at: "2026-09-30T20:30:00Z",
  category_id: "c1",
  category_name: "Механический",
  category_sort_order: 1,
  executor_names: [],
  materials: [],
  ...over,
});

const rows: WorkRow[] = [
  row({ task_id: "t1", title: "Покраска щита", category_id: "c2", category_name: "Энергетический", category_sort_order: 0 }),
  row({ task_id: "t2", title: "Сварка рамы" }),
  row({
    task_id: "t3",
    title: "Ремонт насоса",
    executor_names: ["Иванов Иван", "Петров Пётр"],
    materials: [
      { name: "Краска", unit: "л", quantity: 1 },
      { name: "Электрод", unit: "кг", quantity: 2.5 },
    ],
  }),
  row({ task_id: "t4", title: "Без цеха работа", category_id: null, category_name: null, category_sort_order: null }),
];

describe("groupWorksByCategory", () => {
  it("группы в порядке строк RPC, «Без цеха» — подпись", () => {
    const groups = groupWorksByCategory(rows);
    expect(groups.map((g) => [g.categoryId, g.categoryName, g.works.map((w) => w.title)])).toEqual([
      ["c2", "Энергетический", ["Покраска щита"]],
      ["c1", "Механический", ["Сварка рамы", "Ремонт насоса"]],
      [null, "Без цеха", ["Без цеха работа"]],
    ]);
  });

  it("строка несёт исполнителей и материалы с числовым количеством", () => {
    const work = groupWorksByCategory([row({ materials: [{ name: "Диск", unit: "шт", quantity: "3" as unknown as number }] })])[0]
      .works[0];
    expect(work.materials).toEqual([{ name: "Диск", unit: "шт", quantity: 3 }]);
  });
});

describe("filterWorkGroups", () => {
  const groups = groupWorksByCategory(rows);

  it("все, без цеха, конкретный цех, неизвестный", () => {
    expect(filterWorkGroups(groups, "all")).toHaveLength(3);
    expect(filterWorkGroups(groups, "none").map((g) => g.categoryName)).toEqual(["Без цеха"]);
    expect(filterWorkGroups(groups, "c1").map((g) => g.categoryName)).toEqual(["Механический"]);
    expect(filterWorkGroups(groups, "c9")).toEqual([]);
  });
});

describe("formatMaterials", () => {
  it("«Краска 1 л; Электрод 2,5 кг», пусто — пустая строка", () => {
    expect(
      formatMaterials([
        { name: "Краска", unit: "л", quantity: 1 },
        { name: "Электрод", unit: "кг", quantity: 2.5 },
      ]),
    ).toBe("Краска 1 л; Электрод 2,5 кг");
    expect(formatMaterials([])).toBe("");
  });
});

describe("buildWorksCsv", () => {
  it("BOM, колонки, дата в timezone проекта, экранирование и защита от формул", () => {
    const csv = buildWorksCsv(
      groupWorksByCategory([
        ...rows,
        row({ task_id: "t5", title: '=1+1; "срочно"', category_id: "c1", completed_at: "2026-09-30T21:00:00Z" }),
      ]),
      "Europe/Moscow",
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Цех;Дата выполнения;Заявка;Исполнители;Материалы",
      "Энергетический;30.09.2026;Покраска щита;;",
      "Механический;30.09.2026;Сварка рамы;;",
      'Механический;30.09.2026;Ремонт насоса;Иванов Иван, Петров Пётр;"Краска 1 л; Электрод 2,5 кг"',
      `Механический;01.10.2026;"'=1+1; ""срочно""";;`,
      "Без цеха;30.09.2026;Без цеха работа;;",
      "",
    ]);
  });
});

describe("worksReportQuery", () => {
  it("вкладка, месяц, цех кроме «все»", () => {
    expect(worksReportQuery("2026-09", "all")).toBe("report=works&month=2026-09");
    expect(worksReportQuery("2026-09", "none")).toBe("report=works&month=2026-09&category=none");
  });
});
```

- [ ] **Step 6: Запустить — падает**

Run: `npx vitest run lib/business/works-report.test.ts`
Expected: FAIL — модуль `./works-report` не найден.

- [ ] **Step 7: Реализация**

`lib/business/works-report.ts`:

```ts
// Отчёт «Выполненные работы за месяц» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md).
// Выборка и порядок — в БД (public.completed_works_report, 0025), здесь —
// группировка по цеху, фильтр, форматирование для экрана и CSV.

import { buildCsv, csvText } from "./csv";
import { formatDateNumeric } from "./dates";
import { ALL_CATEGORIES, NO_CATEGORY, NO_CATEGORY_LABEL, formatQuantity } from "./material-report";

/** Значение параметра report вкладки «Выполненные работы» на странице отчётов. */
export const WORKS_REPORT = "works";

export type WorkMaterial = { name: string; unit: string; quantity: number };

export type WorkRow = {
  task_id: string;
  title: string;
  completed_at: string;
  category_id: string | null;
  category_name: string | null;
  category_sort_order: number | null;
  executor_names: string[];
  materials: WorkMaterial[];
};

export type Work = {
  taskId: string;
  title: string;
  completedAt: string;
  executorNames: string[];
  materials: WorkMaterial[];
};

export type WorkGroup = { categoryId: string | null; categoryName: string; works: Work[] };

/** Строки RPC уже упорядочены по цеху и дате — порядок сохраняется. */
export function groupWorksByCategory(rows: WorkRow[]): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();

  for (const row of rows) {
    const key = row.category_id ?? NO_CATEGORY;
    let group = groups.get(key);
    if (!group) {
      group = { categoryId: row.category_id, categoryName: row.category_name ?? NO_CATEGORY_LABEL, works: [] };
      groups.set(key, group);
    }
    group.works.push({
      taskId: row.task_id,
      title: row.title,
      completedAt: row.completed_at,
      executorNames: row.executor_names ?? [],
      materials: (row.materials ?? []).map((m) => ({ name: m.name, unit: m.unit, quantity: Number(m.quantity) })),
    });
  }

  return [...groups.values()];
}

export function filterWorkGroups(groups: WorkGroup[], category: string): WorkGroup[] {
  if (category === ALL_CATEGORIES) return groups;
  if (category === NO_CATEGORY) return groups.filter((g) => g.categoryId === null);
  return groups.filter((g) => g.categoryId === category);
}

/** «Электрод 2,5 кг; Краска 1 л» — для строки отчёта и ячейки CSV. */
export function formatMaterials(materials: WorkMaterial[]): string {
  return materials.map((m) => `${m.name} ${formatQuantity(m.quantity)} ${m.unit}`).join("; ");
}

/** CSV совпадает с экраном, включая фильтр по цеху (формат — csv.ts). */
export function buildWorksCsv(groups: WorkGroup[], timezone: string): string {
  const lines = [["Цех", "Дата выполнения", "Заявка", "Исполнители", "Материалы"]];

  for (const group of groups) {
    for (const work of group.works) {
      lines.push([
        csvText(group.categoryName),
        formatDateNumeric(work.completedAt, timezone),
        csvText(work.title),
        csvText(work.executorNames.join(", ")),
        csvText(formatMaterials(work.materials)),
      ]);
    }
  }

  return buildCsv(lines);
}

/** Query-строка вкладки работ: report, month и цех (кроме «все»). */
export function worksReportQuery(month: string, category: string): string {
  const params = new URLSearchParams({ report: WORKS_REPORT, month });
  if (category !== ALL_CATEGORIES) params.set("category", category);
  return params.toString();
}
```

- [ ] **Step 8: Прогнать**

Run: `npx vitest run lib/business/works-report.test.ts lib/business/csv.test.ts lib/business/material-report.test.ts`
Expected: PASS. Если `formatQuantity` даёт неразрывный пробел в тысячах — в тестах тысяч нет, ожидания не зависят от него.

- [ ] **Step 9: Commit**

```bash
git add lib/business/csv.ts lib/business/csv.test.ts lib/business/works-report.ts lib/business/works-report.test.ts lib/business/material-report.ts
git commit -m "feat(reports): группировка и CSV отчёта выполненных работ, общий csv.ts"
```

---

### Task 3: Загрузка отчёта и CSV-выгрузка

**Files:**
- Create: `app/(app)/[projectId]/reports/works-data.ts`
- Create: `app/(app)/[projectId]/reports/works/export/route.ts`

**Interfaces:**
- Consumes: RPC `completed_works_report` (Task 1); `groupWorksByCategory`, `filterWorkGroups`, `buildWorksCsv`, `WorkGroup`, `WorkRow` (Task 2); `resolveMonth`, `monthStart` (`material-report.ts`); `resolveCategoryFilter` (`reports/data.ts`); `todayInTimezone` (`dates.ts`).
- Produces: `loadWorksReport(projectId: string, monthParam: unknown, category: string): Promise<WorksReport>`, где `WorksReport = { ok: true; month: string; today: string; timezone: string; groups: WorkGroup[] } | { ok: false; month: string; today: string; timezone: string }`.

- [ ] **Step 1: Загрузка**

`app/(app)/[projectId]/reports/works-data.ts`:

```ts
import { todayInTimezone } from "@/lib/business/dates";
import { monthStart, resolveMonth } from "@/lib/business/material-report";
import { filterWorkGroups, groupWorksByCategory, type WorkGroup, type WorkRow } from "@/lib/business/works-report";
import { createClient } from "@/lib/supabase/server";

// Общая загрузка отчёта «Выполненные работы» для страницы и CSV — файл всегда
// совпадает с экраном. Только для серверного кода.

export type WorksReport =
  | { ok: true; month: string; today: string; timezone: string; groups: WorkGroup[] }
  | { ok: false; month: string; today: string; timezone: string };

export async function loadWorksReport(projectId: string, monthParam: unknown, category: string): Promise<WorksReport> {
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle();

  const timezone = project?.timezone ?? "Europe/Moscow";
  const today = todayInTimezone(timezone);
  const month = resolveMonth(monthParam, today);

  const { data, error } = await supabase.rpc("completed_works_report", {
    p_project_id: projectId,
    p_month: monthStart(month),
  });

  if (error) {
    console.error("loadWorksReport:", error);
    return { ok: false, month, today, timezone };
  }

  // Сгенерированные типы не знают, что цех nullable (left join) и форму jsonb материалов.
  const rows = (data ?? []) as unknown as WorkRow[];
  return { ok: true, month, today, timezone, groups: filterWorkGroups(groupWorksByCategory(rows), category) };
}
```

- [ ] **Step 2: Route выгрузки**

`app/(app)/[projectId]/reports/works/export/route.ts`:

```ts
import type { NextRequest } from "next/server";

import { buildWorksCsv } from "@/lib/business/works-report";

import { resolveCategoryFilter } from "../../data";
import { loadWorksReport } from "../../works-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CSV отчёта «Выполненные работы». Неавторизованный запрос сюда не доходит
// (proxy.ts), доступ к данным проекта ограничивает RLS внутри RPC.
export async function GET(request: NextRequest, ctx: RouteContext<"/[projectId]/reports/works/export">) {
  const { projectId } = await ctx.params;

  if (!UUID_RE.test(projectId)) {
    return new Response("Not found", { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const category = resolveCategoryFilter(search.get("category"));
  const report = await loadWorksReport(projectId, search.get("month"), category);

  if (!report.ok) {
    return new Response("Не удалось построить отчёт. Попробуйте ещё раз.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(buildWorksCsv(report.groups, report.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="completed-works-${report.month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 3: Проверить типы**

Run: `npx next typegen >/dev/null 2>&1; npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`. (`RouteContext<…>` для нового маршрута генерирует `next typegen`.)

- [ ] **Step 4: Проверить выгрузку в браузере/curl после Task 4** — здесь только сборка; ручная проверка ответа — в Task 4, Step 6.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/[projectId]/reports/works-data.ts" "app/(app)/[projectId]/reports/works/export/route.ts"
git commit -m "feat(reports): загрузка и CSV-выгрузка отчёта выполненных работ"
```

---

### Task 4: Вкладки на странице отчётов и отчёт работ

**Files:**
- Create: `app/(app)/[projectId]/reports/styles.ts`
- Create: `app/(app)/[projectId]/reports/works-report.tsx`
- Modify: `app/(app)/[projectId]/reports/page.tsx`
- Modify: `app/(app)/[projectId]/reports/category-filter.tsx`

**Interfaces:**
- Consumes: `loadWorksReport`, `WorksReport` (Task 3); `formatMaterials`, `worksReportQuery`, `WORKS_REPORT` (Task 2).
- Produces: `MONTH_SEGMENT_CLASS`, `TAB_CLASS`, `TAB_ACTIVE_CLASS` из `styles.ts`; `CategoryFilter` с необязательным пропом `report?: string`.

- [ ] **Step 1: Общие классы**

`app/(app)/[projectId]/reports/styles.ts`:

```ts
// Сегментированные группы кнопок страницы отчётов — как навигация по неделям
// на доске и вкладки страницы «Заявки».
export const MONTH_SEGMENT_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink active:bg-[#EBEFF5]";

export const TAB_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium whitespace-nowrap text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink";

export const TAB_ACTIVE_CLASS = "bg-brand-surface text-brand hover:bg-brand-surface hover:text-brand";
```

В `page.tsx` удалить локальную константу `MONTH_SEGMENT_CLASS` и импортировать её из `./styles`.

- [ ] **Step 2: Фильтр цеха сохраняет вкладку**

В `category-filter.tsx` добавить проп `report?: string` и использовать его при сборке адреса:

```tsx
export function CategoryFilter({
  report,
  month,
  category,
  categories,
}: {
  /** Вкладка страницы отчётов (`works`); без неё — отчёт по расходу. */
  report?: string;
  month: string;
  category: string;
  categories: { id: string; name: string }[];
}) {
```

```tsx
  const onChange = (next: string) => {
    const params = new URLSearchParams(report ? { report, month } : { month });
    if (next !== ALL_CATEGORIES) params.set("category", next);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };
```

- [ ] **Step 3: Отчёт работ**

`app/(app)/[projectId]/reports/works-report.tsx`:

```tsx
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateNumeric } from "@/lib/business/dates";
import { addMonths, formatMonthLabel } from "@/lib/business/material-report";
import { WORKS_REPORT, formatMaterials, worksReportQuery } from "@/lib/business/works-report";
import { cn } from "@/lib/utils";

import { CategoryFilter } from "./category-filter";
import { MONTH_SEGMENT_CLASS } from "./styles";
import type { WorksReport as WorksReportData } from "./works-data";

/** Вкладка «Выполненные работы» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md §3). */
export function WorksReport({
  projectId,
  category,
  categories,
  report,
}: {
  projectId: string;
  category: string;
  categories: { id: string; name: string }[];
  report: WorksReportData;
}) {
  const { month, today, timezone } = report;
  const monthLabel = formatMonthLabel(month);
  const isCurrentMonth = month === today.slice(0, 7);
  const base = `/${projectId}/reports`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <CardTitle>Выполненные работы по цехам</CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <div className="flex items-center overflow-hidden rounded-[7px] border border-control bg-surface">
            <Link href={`${base}?${worksReportQuery(addMonths(month, -1), category)}`} className={MONTH_SEGMENT_CLASS}>
              ← Пред.
            </Link>
            {!isCurrentMonth ? (
              <Link href={`${base}?${worksReportQuery(today.slice(0, 7), category)}`} className={MONTH_SEGMENT_CLASS}>
                Текущий
              </Link>
            ) : null}
            <Link href={`${base}?${worksReportQuery(addMonths(month, 1), category)}`} className={MONTH_SEGMENT_CLASS}>
              След. →
            </Link>
          </div>
          <span className="text-[13px] font-semibold text-ink">{monthLabel}</span>
          <CategoryFilter report={WORKS_REPORT} month={month} category={category} categories={categories} />
          {report.ok && report.groups.length > 0 ? (
            // Обычная ссылка, а не Link: ответ — файл, а не страница приложения.
            <a
              href={`${base}/works/export?${worksReportQuery(month, category)}`}
              className={cn(buttonVariants({ variant: "outline" }), "sm:ml-auto")}
            >
              Скачать CSV
            </a>
          ) : null}
        </div>
        <p className="text-[11.5px] text-meta-alt">
          Заявки, выполненные в этом месяце. Цех — текущая категория заявки. Материалы — итог расхода по заявке.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!report.ok ? (
          <p role="alert" className="text-[12.5px] text-status-alert-fg">
            Не удалось построить отчёт. Обновите страницу.
          </p>
        ) : report.groups.length === 0 ? (
          <EmptyState>За {monthLabel.toLowerCase()} выполненных работ нет.</EmptyState>
        ) : (
          report.groups.map((group) => (
            <section key={group.categoryId ?? "none"} className="flex flex-col">
              <h2 className="border-b border-line-strong pb-1.5 text-[13px] font-semibold text-ink">
                {group.categoryName} · {group.works.length}
              </h2>
              <ul className="divide-y divide-line-subtle text-[12.5px]">
                {group.works.map((work) => (
                  <li key={work.taskId} className="flex gap-3 py-2">
                    <span className="w-11 shrink-0 font-mono text-[12px] text-meta">
                      {formatDateNumeric(work.completedAt, timezone).slice(0, 5)}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/${projectId}/tasks/${work.taskId}`} className="break-words text-ink hover:underline">
                        {work.title}
                      </Link>
                      {work.executorNames.length > 0 ? (
                        <span className="text-[12px] break-words text-meta">{work.executorNames.join(", ")}</span>
                      ) : null}
                      {work.materials.length > 0 ? (
                        <span className="text-[12px] break-words text-meta-alt">{formatMaterials(work.materials)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Вкладки и ветвление на странице**

В `page.tsx`:

1. Импорты: `import { WORKS_REPORT } from "@/lib/business/works-report";`, `import { MONTH_SEGMENT_CLASS, TAB_ACTIVE_CLASS, TAB_CLASS } from "./styles";`, `import { WorksReport } from "./works-report";`, `import { loadWorksReport } from "./works-data";`. Метаданные: `title: "Отчёты — Repair Planner"`.
2. Добавить компонент вкладок в файле страницы:

```tsx
function ReportTabs({ base, isWorks }: { base: string; isWorks: boolean }) {
  return (
    <nav aria-label="Отчёты" className="flex self-start overflow-hidden rounded-[7px] border border-control bg-surface">
      <Link href={base} aria-current={isWorks ? undefined : "page"} className={cn(TAB_CLASS, !isWorks && TAB_ACTIVE_CLASS)}>
        Расход материалов
      </Link>
      <Link
        href={`${base}?report=${WORKS_REPORT}`}
        aria-current={isWorks ? "page" : undefined}
        className={cn(TAB_CLASS, isWorks && TAB_ACTIVE_CLASS)}
      >
        Выполненные работы
      </Link>
    </nav>
  );
}
```

3. Начало `ReportsPage` заменить так, чтобы отчёт по расходу грузился только на своей вкладке:

```tsx
  const { projectId } = await params;
  const { month: monthParam, category: categoryParam, report: reportParam } = await searchParams;
  const category = resolveCategoryFilter(categoryParam);
  const isWorks = reportParam === WORKS_REPORT;
  const base = `/${projectId}/reports`;

  const supabase = await createClient();
  // Архивные цеха остаются в фильтре: по ним могли быть работы и расход в прошлых месяцах.
  const categoriesQuery = supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("project_id", projectId)
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true });
  const categoryOptions = (rows: { id: string; name: string; is_archived: boolean }[] | null) =>
    (rows ?? []).map((c) => ({ id: c.id, name: c.is_archived ? `${c.name} (архив)` : c.name }));

  if (isWorks) {
    const [works, { data: categories }] = await Promise.all([
      loadWorksReport(projectId, monthParam, category),
      categoriesQuery,
    ]);
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pt-6 pb-7">
        <ReportTabs base={base} isWorks />
        <WorksReport projectId={projectId} category={category} categories={categoryOptions(categories)} report={works} />
      </main>
    );
  }

  const [report, { data: categories }] = await Promise.all([
    loadConsumptionReport(projectId, monthParam, category),
    categoriesQuery,
  ]);
```

Далее существующий код без изменений, кроме: удалить повторное объявление `base`; в `<main>` перед `<Card>` вставить `<ReportTabs base={base} isWorks={false} />`; в `CategoryFilter` передать `categories={categoryOptions(categories)}` вместо локального `map`.

- [ ] **Step 5: Проверки**

Run: `npx tsc --noEmit && echo TSC_OK; npx eslint . && echo LINT_OK; npm test 2>&1 | grep -E "Tests "`
Expected: `TSC_OK`, `LINT_OK`, все тесты зелёные.

- [ ] **Step 6: Браузер (локальный проект `1b919349-da4f-4481-b218-9d1552e40180`)**

1. `preview_start` `dev`; открыть `/…/reports` — вкладка «Расход материалов» активна, отчёт по расходу как раньше.
2. «Выполненные работы» → `?report=works`, текущий месяц; есть заявка «Тест переноса: завершена» (выполнена 07.10) в своей группе.
3. ← Пред. — пустой сентябрь: «За сентябрь 2026 выполненных работ нет.», кнопки CSV нет.
4. Сменить цех в фильтре — адрес сохраняет `report=works` (Review Focus).
5. Временно добавить материал и расход к выполненной заявке (как в п. 16: `QA Электрод`, удалить после вместе с `material_movements`) — строка «QA Электрод 2,5 кг».
6. Ссылка «Скачать CSV»: `read_network_requests`/`fetch` в JS — `content-type: text/csv`, первая строка `Цех;Дата выполнения;Заявка;Исполнители;Материалы`.
7. 1280 и 375: вкладки и строка навигации переносятся без горизонтального скролла; консоль без ошибок.
8. Удалить временные данные.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/[projectId]/reports/styles.ts" "app/(app)/[projectId]/reports/works-report.tsx" "app/(app)/[projectId]/reports/page.tsx" "app/(app)/[projectId]/reports/category-filter.tsx"
git commit -m "feat(reports): вкладка «Выполненные работы» на странице отчётов"
```

---

### Task 5: Документация и финальная проверка

**Files:**
- Modify: `docs/product-requirements.md`, `docs/database.md`, `docs/architecture.md`, `docs/roadmap.md`

- [ ] **Step 1: PRD.** После §4.11 добавить §4.12 «Отчёт „Выполненные работы“» (решения из спецификации §2–3: календарный месяц в timezone проекта, только выполненные, группы по текущему цеху в порядке справочника, «Без цеха» последней, строка — дата, название, исполнители, материалы как итог расхода по заявке; возможное расхождение с отчётом по расходу; CSV с колонками «Цех; Дата выполнения; Заявка; Исполнители; Материалы»; viewer видит и выгружает).

- [ ] **Step 2: database.md.** В таблицу RPC — строка `completed_works_report(p_project_id, p_month)` (0025): выполненные заявки месяца в timezone проекта с исполнителями (`text[]` по имени) и материалами (`jsonb` `[{name, unit, quantity}]` по названию), порядок `categories.sort_order nulls last, name, completed_at, id`, security invoker, RLS. В список миграций — `25. 0025_completed_works_report — RPC completed_works_report.`

- [ ] **Step 3: architecture.md.** В разделе страниц: `/[projectId]/reports` — вкладки «Расход материалов» и «Выполненные работы» (`?report=works`), загрузка `reports/works-data.ts` → RPC `completed_works_report` (0025), выгрузка `reports/works/export`; CSV-формат общий — `lib/business/csv.ts`.

- [ ] **Step 4: roadmap.md.** `17. ~~Отчёт «выполненные работы за период» с выгрузкой~~ — сделано (0025, 2026-10-08).` В конец — пункт: «Отчёт работ: произвольный период, итоги по исполнителям, печатная форма — по запросу.»

- [ ] **Step 5: Полная проверка**

Run: `npx tsc --noEmit && npx eslint . && npm test && supabase test db && npm run build`
Expected: всё зелёное (vitest 197 + 9 новых = 206, pgTAP 298), сборка успешна.

Run: `supabase db push --dry-run`
Expected: к отправке только `0025_completed_works_report.sql`.

- [ ] **Step 6: Commit**

```bash
git add docs/product-requirements.md docs/database.md docs/architecture.md docs/roadmap.md
git commit -m "docs: отчёт «Выполненные работы» (п. 17)"
```
