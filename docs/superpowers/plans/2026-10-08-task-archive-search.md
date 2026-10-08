# Архив выполненных работ и поиск — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вкладка «Архив» на странице «Заявки»: выполненные и отменённые заявки с поиском по тексту, периоду выполнения, цеху и исполнителю.

**Architecture:** Фильтрация — в SQL-функции `public.search_archive_tasks` (security invoker, RLS действует), миграция 0020. Страница остаётся Server Component; фильтры — GET-форма, состояние в URL, разбор параметров — чистые функции с vitest. «Показать ещё» — ссылка `page=N+1`, функция просит `N*50+1` строк.

**Tech Stack:** Next.js 16 App Router, Supabase PostgreSQL 17 (pgTAP), Zod 4, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-08-task-archive-search-design.md`

## Global Constraints

- Ответы и тексты UI — по-русски; пользователю не показывать SQL, коды ошибок, stack trace (CLAUDE.md §31).
- Даты — в timezone проекта (`projects.timezone`), не браузера и не сервера (CLAUDE.md §32).
- Миграции не редактировать задним числом: 0019 уже на проде, новая — `0020_search_archive_tasks.sql`.
- Функции БД: `set search_path = ''`, `revoke all ... from public, anon`, `grant execute ... to authenticated` (0016).
- Никогда не запускать `supabase db reset`; локально — `supabase migration up --local`.
- Без новых зависимостей. Клиентский JS вкладка архива не добавляет.
- Тексты: «Не удалось загрузить архив. Обновите страницу.», «Ничего не найдено. Измените условия поиска.», «Выполненных заявок пока нет.», «Уточните условия поиска», «Период — по дате выполнения, показаны только выполненные».
- Лимит страницы 50, максимум 20 страниц, текст поиска до 100 символов.

## Review Focus

1. Поля формы после перехода по ссылке («Этот месяц», «Сбросить», «Показать ещё») показывают значения текущего URL, а не старые — форма перемонтируется по `key` (Task 3, проверка в браузере, шаг 6).
2. Текст поиска с запятыми, скобками и кавычками (`насос, (ремонт) "А"`) не ломает запрос и не даёт ошибку (Task 1, pgTAP-тест 24).
3. Участник проекта с ролью `viewer` видит архив проекта (Task 1, pgTAP-тест 25).
4. Длинный текст из URL (руками отредактированный адрес) обрезается до 100 символов, неверные id и даты не роняют страницу (Task 2, vitest).
5. Дата в строке результата совпадает с датой, по которой фильтрует период (обе — в timezone проекта): заявка, выполненная в 01:00 по Москве 1 октября, показана как 01.10 и попадает в «с 01.10» (Task 1 pgTAP-тест 7, Task 2 тест `formatDateNumeric`).

---

## Решения плана относительно спецификации

- Функция — `language plpgsql` (спецификация писала `sql`): нужен `raise exception 'invalid_filter'`. Поведение то же.
- Параметры после `p_status` получают `default` (`null`, у `p_limit` — `50`): тогда сгенерированные TS-типы делают их необязательными, и «нет фильтра» передаётся как `undefined`, без приведения `null as string`.

## Файлы

| Файл | Ответственность |
|---|---|
| `supabase/migrations/0020_search_archive_tasks.sql` (создать) | функция поиска |
| `supabase/tests/database/archive-search.test.sql` (создать) | pgTAP функции |
| `lib/types/database.ts` (регенерировать) | типы RPC |
| `lib/validation/archive-filters.ts` (+ `.test.ts`) (создать) | разбор `searchParams`, сборка query-строки |
| `lib/business/archive-periods.ts` (+ `.test.ts`) (создать) | «этот / прошлый месяц» |
| `lib/business/dates.ts`, `dates.test.ts` (изменить) | `formatDateNumeric` |
| `app/(app)/[projectId]/tasks/archive-data.ts` (создать) | вызов RPC |
| `app/(app)/[projectId]/tasks/archive-filters-form.tsx` (создать) | GET-форма фильтров |
| `app/(app)/[projectId]/tasks/archive-list.tsx` (создать) | список, пустые состояния, «Показать ещё» |
| `app/(app)/[projectId]/tasks/archive-tab.tsx` (создать) | загрузка справочников и сборка вкладки |
| `app/(app)/[projectId]/tasks/page.tsx` (изменить) | вкладки, открытые заявки без закрытых |
| `docs/*.md` (изменить) | документация |

---

### Task 1: SQL-функция `search_archive_tasks`

**Files:**
- Create: `supabase/migrations/0020_search_archive_tasks.sql`
- Create: `supabase/tests/database/archive-search.test.sql`
- Modify: `lib/types/database.ts` (генерация)
- Modify: `docs/database.md` (таблица RPC, список миграций, число pgTAP-тестов)

**Interfaces:**
- Produces: `public.search_archive_tasks(p_project_id uuid, p_status text, p_query text default null, p_category_id uuid default null, p_executor_id uuid default null, p_from date default null, p_to date default null, p_limit int default 50) returns table (id uuid, title text, status public.task_status, completed_at timestamptz, category_name text, executor_names text[])`. В TS: `supabase.rpc("search_archive_tasks", { p_project_id, p_status, p_query?, p_category_id?, p_executor_id?, p_from?, p_to?, p_limit? })`.

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/database/archive-search.test.sql`:

```sql
-- Архив выполненных работ и поиск (0020): public.search_archive_tasks.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(25);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A (Europe/Moscow), B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'archive-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'archive-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'archive-viewer-c@example.com');

insert into public.projects (id, owner_id, name, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A', 'Europe/Moscow'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B', 'Europe/Moscow');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.categories (id, project_id, name, is_archived) values
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Механический', false),
  ('c1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Энергетический', true);

insert into public.executors (id, project_id, name, is_active) values
  ('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Иванов Иван', true),
  ('e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Петров Пётр', false);

-- A1: 20:30 UTC 30.09 = 23:30 МСК 30.09. A2: 22:00 UTC 30.09 = 01:00 МСК 01.10.
insert into public.tasks (id, project_id, title, description, status, completed_at, category_id) values
  ('f2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ремонт насоса', null,
   'completed', '2026-09-30 20:30+00', 'c1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Замена ворот', 'Краска 100% покрытие',
   'completed', '2026-09-30 22:00+00', 'c1000000-0000-0000-0000-000000000002'),
  ('f2000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сварка рамы', null,
   'completed', '2026-08-15 10:00+00', null),
  ('f2000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Ремонт насоса B', null,
   'completed', '2026-09-20 10:00+00', null);

insert into public.tasks (id, project_id, title, status) values
  ('f2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Покраска_стен', 'cancelled'),
  ('f2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Насосная станция', 'new');

insert into public.task_executors (task_id, executor_id, project_id) values
  ('f2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1
select has_function('public', 'search_archive_tasks',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'date', 'date', 'integer'],
  'search_archive_tasks exists');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 2. По умолчанию — выполненные, свежие сверху; открытые и чужие не попадают
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed')),
  array['Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'completed: newest first, open and foreign excluded'
);

-- 3
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cancelled')),
  array['Покраска_стен'],
  'cancelled only'
);

-- 4. Отменённая изменена сейчас — она свежее всех выполненных
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all')),
  array['Покраска_стен', 'Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'all: cancelled by updated_at, completed by completed_at'
);

-- 5. Заданный период исключает отменённые даже при 'all'
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_from => '2026-08-01', p_to => '2026-10-31')),
  array['Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'period excludes cancelled even for all'
);

-- 6. «по 30.09» включает 23:30 МСК 30.09 и не включает 01:00 МСК 01.10
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_to => '2026-09-30')),
  array['Ремонт насоса', 'Сварка рамы'],
  'p_to is inclusive and uses the project timezone'
);

-- 7. «с 01.10» включает 01:00 МСК 01.10 (по UTC это ещё 30.09)
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_from => '2026-10-01')),
  array['Замена ворот'],
  'p_from uses the project timezone'
);

-- 8. Текст без учёта регистра; открытая «Насосная станция» и чужой «Ремонт насоса B» не попадают
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_query => 'НАСОС')),
  array['Ремонт насоса'],
  'text search is case-insensitive'
);

-- 9. Текст ищется и в описании
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_query => 'покрытие')),
  array['Замена ворот'],
  'text search covers description'
);

-- 10. «%» ищется буквально
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_query => '%')),
  array['Замена ворот'],
  'percent sign is matched literally'
);

-- 11. «_» ищется буквально
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_query => '_')),
  array['Покраска_стен'],
  'underscore is matched literally'
);

-- 12. Пробелы — как пустой запрос
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_query => '   ')),
  array['Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'blank query means no text filter'
);

-- 13. Архивный цех
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_category_id => 'c1000000-0000-0000-0000-000000000002')),
  array['Замена ворот'],
  'filters by an archived category'
);

-- 14
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_executor_id => 'e1000000-0000-0000-0000-000000000001')),
  array['Ремонт насоса'],
  'filters by executor'
);

-- 15. Неактивный исполнитель
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_executor_id => 'e1000000-0000-0000-0000-000000000002')),
  array['Замена ворот'],
  'filters by an inactive executor'
);

-- 16
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_limit => 2)),
  array['Замена ворот', 'Ремонт насоса'],
  'limit keeps the newest rows'
);

-- 17. Лимит меньше 1 зажимается до 1
select is(
  (select count(*)::int from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_limit => 0)),
  1,
  'limit below 1 is clamped to 1'
);

-- 18. Колонки строки
select row_eq(
  $$ select category_name, executor_names from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'completed', p_query => 'Ремонт') $$,
  row('Механический'::text, array['Иванов Иван']::text[]),
  'row carries category name and executor names'
);

-- 19. Без цеха и исполнителей — null и пустой массив
select row_eq(
  $$ select category_name, executor_names from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'completed', p_query => 'Сварка') $$,
  row(null::text, '{}'::text[]),
  'no category gives null, no executors give an empty array'
);

-- 20
select throws_ok(
  $$ select * from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open') $$,
  'invalid_filter',
  'unknown status raises invalid_filter'
);

-- 24. Запятые, скобки и кавычки — обычный текст, без ошибки
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_query => 'насос, (ремонт) "А"')),
  array[]::text[],
  'punctuation in the query is plain text'
);

reset role;

-- ================= Владелец B =================

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 21. Чужой проект — пусто, не ошибка
select is(
  (select count(*)::int from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all')),
  0,
  'other project gives no rows'
);

-- 22
select is(
  array(select title from public.search_archive_tasks('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'completed')),
  array['Ремонт насоса B'],
  'owner B sees own archive'
);

reset role;

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 25
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed')),
  array['Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'viewer sees the project archive'
);

reset role;

-- 23
select ok(
  not has_function_privilege('anon', 'public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int)', 'execute'),
  'anon cannot execute search_archive_tasks'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db 2>&1 | tail -15`
Expected: `archive-search.test.sql` FAIL — `function public.search_archive_tasks(...) does not exist`; остальные файлы ok.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0020_search_archive_tasks.sql`:

```sql
-- Архив выполненных работ и поиск по нему
-- (docs/superpowers/specs/2026-10-08-task-archive-search-design.md).
-- security invoker: RLS tasks/categories/executors/task_executors действует —
-- чужой проект даёт пустой результат.

create or replace function public.search_archive_tasks(
  p_project_id uuid,
  p_status text,
  p_query text default null,
  p_category_id uuid default null,
  p_executor_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 50
)
returns table (
  id uuid,
  title text,
  status public.task_status,
  completed_at timestamptz,
  category_name text,
  executor_names text[]
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_timezone text;
  -- Период — по дате выполнения: у отменённой её нет, поэтому с периодом только выполненные.
  v_period boolean := p_from is not null or p_to is not null;
begin
  if p_status is null or p_status not in ('completed', 'cancelled', 'all') then
    raise exception 'invalid_filter';
  end if;

  select p.timezone into v_timezone from public.projects p where p.id = p_project_id;
  if not found then
    return;
  end if;

  if v_query is not null then
    -- Текст ищется буквально: экранируем спецсимволы LIKE (escape по умолчанию — «\»).
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    t.id,
    t.title,
    t.status,
    t.completed_at,
    c.name,
    array(
      select e.name
        from public.task_executors te
        join public.executors e on e.id = te.executor_id
        where te.task_id = t.id
        order by e.name
    )
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.project_id = p_project_id
    and case
          when v_period then t.status = 'completed'
          when p_status = 'all' then t.status in ('completed', 'cancelled')
          else t.status = p_status::public.task_status
        end
    and (v_pattern is null or t.title ilike v_pattern or coalesce(t.description, '') ilike v_pattern)
    and (p_category_id is null or t.category_id = p_category_id)
    and (p_executor_id is null or exists (
      select 1 from public.task_executors te2
        where te2.task_id = t.id and te2.executor_id = p_executor_id
    ))
    and (p_from is null or t.completed_at >= (p_from::timestamp at time zone v_timezone))
    and (p_to is null or t.completed_at < ((p_to + 1)::timestamp at time zone v_timezone))
  order by coalesce(t.completed_at, t.updated_at) desc, t.id
  limit least(greatest(coalesce(p_limit, 1), 1), 1001);
end;
$$;

revoke all on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int) from public, anon;
grant execute on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int) to authenticated;
```

- [ ] **Step 4: Apply locally and run pgTAP**

Run: `supabase migration up --local && supabase test db 2>&1 | tail -8`
Expected: `Files=4, Tests=240`, `Result: PASS` (215 + 25).

- [ ] **Step 5: Regenerate types**

Run: `supabase gen types typescript --local > lib/types/database.ts && grep -n "search_archive_tasks" -A12 lib/types/database.ts | head -30 && npx tsc --noEmit`
Expected: в `Args` поля `p_query?`, `p_category_id?`, `p_executor_id?`, `p_from?`, `p_to?`, `p_limit?` необязательные; tsc без ошибок.

- [ ] **Step 6: Update `docs/database.md`**

- В таблицу RPC (рядом со строкой `move_backlog_task`) добавить строку:
  `| \`search_archive_tasks(p_project_id, p_status, p_query, p_category_id, p_executor_id, p_from, p_to, p_limit)\` (0020) | архив: выполненные и отменённые заявки проекта с фильтрами по тексту (название, описание; буквально, без учёта регистра), цеху, исполнителю и периоду выполнения в timezone проекта (включительно); при заданном периоде — только выполненные; сортировка \`coalesce(completed_at, updated_at) desc\`; security invoker, RLS; \`invalid_filter\` |`
- В список миграций после пункта 19: `20. \`0020_search_archive_tasks\` — функция поиска по архиву выполненных работ.`
- В абзаце про pgTAP: добавить `supabase/tests/database/archive-search.test.sql` (25), итог `240/240`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0020_search_archive_tasks.sql supabase/tests/database/archive-search.test.sql lib/types/database.ts docs/database.md
git commit -m "feat(db): функция поиска по архиву выполненных работ"
```

---

### Task 2: Разбор фильтров, быстрые периоды, формат даты

**Files:**
- Create: `lib/validation/archive-filters.ts`, `lib/validation/archive-filters.test.ts`
- Create: `lib/business/archive-periods.ts`, `lib/business/archive-periods.test.ts`
- Modify: `lib/business/dates.ts`, `lib/business/dates.test.ts`

**Interfaces:**
- Consumes: `idSchema` (`lib/validation/board-move.ts`), `isValidDateString` (`lib/business/working-days.ts`).
- Produces:
  - `type ArchiveStatus = "completed" | "cancelled" | "all"`
  - `type ArchiveFilters = { q: string; status: ArchiveStatus; category: string | null; executor: string | null; from: string | null; to: string | null; page: number }`
  - `const ARCHIVE_QUERY_MAX = 100`, `ARCHIVE_PAGE_SIZE = 50`, `ARCHIVE_MAX_PAGE = 20`, `DEFAULT_ARCHIVE_FILTERS: ArchiveFilters`
  - `parseArchiveFilters(params: Record<string, string | string[] | undefined>): ArchiveFilters`
  - `archiveQuery(filters: ArchiveFilters, overrides?: Partial<ArchiveFilters>): string` — всегда начинается с `view=archive`
  - `hasArchiveFilters(filters: ArchiveFilters): boolean`
  - `monthRange(today: string, offset: 0 | -1): { from: string; to: string }`
  - `formatDateNumeric(isoTimestamp: string, timezone: string): string` — `"01.10.2026"`

- [ ] **Step 1: Write the failing tests**

`lib/validation/archive-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_QUERY_MAX,
  DEFAULT_ARCHIVE_FILTERS,
  archiveQuery,
  hasArchiveFilters,
  parseArchiveFilters,
} from "./archive-filters";

const CAT = "3f0c8a52-7d4b-4e7a-9c1e-5b2d6f8a9e10";
const EXE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseArchiveFilters", () => {
  it("без параметров — значения по умолчанию", () => {
    expect(parseArchiveFilters({})).toEqual(DEFAULT_ARCHIVE_FILTERS);
  });

  it("разбирает все поля", () => {
    expect(
      parseArchiveFilters({
        view: "archive",
        q: "  насос ",
        status: "all",
        category: CAT,
        executor: EXE,
        from: "2026-09-01",
        to: "2026-09-30",
        page: "3",
      }),
    ).toEqual({ q: "насос", status: "all", category: CAT, executor: EXE, from: "2026-09-01", to: "2026-09-30", page: 3 });
  });

  it("неверные значения заменяются значениями по умолчанию по отдельности", () => {
    expect(
      parseArchiveFilters({ status: "open", category: "abc", executor: "", from: "2026-02-30", to: "вчера", page: "0", q: "ok" }),
    ).toEqual({ ...DEFAULT_ARCHIVE_FILTERS, q: "ok" });
    expect(parseArchiveFilters({ page: "21" }).page).toBe(1);
    expect(parseArchiveFilters({ page: "2.5" }).page).toBe(1);
  });

  it("повторяющийся параметр — берётся первый", () => {
    expect(parseArchiveFilters({ q: ["первый", "второй"] }).q).toBe("первый");
  });

  it("длинный текст обрезается", () => {
    expect(parseArchiveFilters({ q: "я".repeat(150) }).q).toHaveLength(ARCHIVE_QUERY_MAX);
  });

  it("«с» позже «по» — даты меняются местами", () => {
    const f = parseArchiveFilters({ from: "2026-10-31", to: "2026-10-01" });
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-31"]);
  });
});

describe("archiveQuery", () => {
  it("по умолчанию — только вкладка", () => {
    expect(archiveQuery(DEFAULT_ARCHIVE_FILTERS)).toBe("view=archive");
  });

  it("пропускает значения по умолчанию и применяет overrides", () => {
    const filters = { ...DEFAULT_ARCHIVE_FILTERS, q: "насос", status: "all" as const, page: 2 };
    expect(archiveQuery(filters, { page: 3 })).toBe("view=archive&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&status=all&page=3");
    expect(archiveQuery(filters, { from: "2026-10-01", to: "2026-10-31", page: 1 })).toBe(
      "view=archive&q=%D0%BD%D0%B0%D1%81%D0%BE%D1%81&status=all&from=2026-10-01&to=2026-10-31",
    );
  });

  it("разбор собранной строки возвращает те же фильтры", () => {
    const filters = { q: "ворота", status: "cancelled" as const, category: CAT, executor: EXE, from: null, to: "2026-09-30", page: 4 };
    const params = Object.fromEntries(new URLSearchParams(archiveQuery(filters)));
    expect(parseArchiveFilters(params)).toEqual(filters);
  });
});

describe("hasArchiveFilters", () => {
  it("значения по умолчанию и номер страницы — не фильтры", () => {
    expect(hasArchiveFilters(DEFAULT_ARCHIVE_FILTERS)).toBe(false);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, page: 3 })).toBe(false);
  });

  it("любой заданный фильтр", () => {
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, q: "насос" })).toBe(true);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, status: "cancelled" })).toBe(true);
    expect(hasArchiveFilters({ ...DEFAULT_ARCHIVE_FILTERS, to: "2026-09-30" })).toBe(true);
  });
});
```

`lib/business/archive-periods.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { monthRange } from "./archive-periods";

describe("monthRange", () => {
  it("этот месяц", () => {
    expect(monthRange("2026-10-08", 0)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("прошлый месяц через границу года", () => {
    expect(monthRange("2026-01-15", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("февраль обычного и високосного года", () => {
    expect(monthRange("2026-03-31", -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-03-10", -1)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
```

В конец `lib/business/dates.test.ts` (и `formatDateNumeric` в импорт `./dates`):

```ts
describe("formatDateNumeric", () => {
  it("formats the date of the moment in the project timezone", () => {
    // 22:00 UTC 30 сентября — уже 1 октября в Москве.
    expect(formatDateNumeric("2026-09-30T22:00:00+00:00", "Europe/Moscow")).toBe("01.10.2026");
    expect(formatDateNumeric("2026-09-30T22:00:00+00:00", "UTC")).toBe("30.09.2026");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/validation/archive-filters.test.ts lib/business/archive-periods.test.ts lib/business/dates.test.ts 2>&1 | tail -8`
Expected: FAIL — `Failed to resolve import "./archive-filters"`, `"./archive-periods"`; `formatDateNumeric is not a function`.

- [ ] **Step 3: Implement**

`lib/validation/archive-filters.ts`:

```ts
import { z } from "zod";

import { isValidDateString } from "@/lib/business/working-days";

import { idSchema } from "./board-move";

// Фильтры вкладки «Архив» страницы «Заявки» живут в URL
// (docs/superpowers/specs/2026-10-08-task-archive-search-design.md §4.1).
// Адрес могли отредактировать руками: неверное поле молча получает значение
// по умолчанию, остальные поля не страдают.

export const ARCHIVE_STATUSES = ["completed", "cancelled", "all"] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const ARCHIVE_QUERY_MAX = 100;
export const ARCHIVE_PAGE_SIZE = 50;
export const ARCHIVE_MAX_PAGE = 20;

export type ArchiveFilters = {
  q: string;
  status: ArchiveStatus;
  category: string | null;
  executor: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

export const DEFAULT_ARCHIVE_FILTERS: ArchiveFilters = {
  q: "",
  status: "completed",
  category: null,
  executor: null,
  from: null,
  to: null,
  page: 1,
};

type SearchParams = Record<string, string | string[] | undefined>;

const statusSchema = z.enum(ARCHIVE_STATUSES);
const dateSchema = z.string().refine(isValidDateString);
const pageSchema = z.coerce.number().int().min(1).max(ARCHIVE_MAX_PAGE);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T, F>(schema: z.ZodType<T>, value: unknown, fallback: F): T | F {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

export function parseArchiveFilters(params: SearchParams): ArchiveFilters {
  let from = pick(dateSchema, first(params.from), null);
  let to = pick(dateSchema, first(params.to), null);
  if (from !== null && to !== null && from > to) [from, to] = [to, from];

  return {
    q: (first(params.q) ?? "").trim().slice(0, ARCHIVE_QUERY_MAX),
    status: pick(statusSchema, first(params.status), DEFAULT_ARCHIVE_FILTERS.status),
    category: pick(idSchema, first(params.category), null),
    executor: pick(idSchema, first(params.executor), null),
    from,
    to,
    page: pick(pageSchema, first(params.page), 1),
  };
}

/** Query-строка вкладки архива; поля со значением по умолчанию опускаются. */
export function archiveQuery(filters: ArchiveFilters, overrides: Partial<ArchiveFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams({ view: "archive" });
  if (f.q) params.set("q", f.q);
  if (f.status !== DEFAULT_ARCHIVE_FILTERS.status) params.set("status", f.status);
  if (f.category) params.set("category", f.category);
  if (f.executor) params.set("executor", f.executor);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.page > 1) params.set("page", String(f.page));
  return params.toString();
}

/** Задан ли хоть один фильтр (номер страницы — не фильтр). */
export function hasArchiveFilters(f: ArchiveFilters): boolean {
  return (
    f.q !== "" ||
    f.status !== DEFAULT_ARCHIVE_FILTERS.status ||
    f.category !== null ||
    f.executor !== null ||
    f.from !== null ||
    f.to !== null
  );
}
```

`lib/business/archive-periods.ts`:

```ts
// Быстрые периоды фильтра архива. today — "YYYY-MM-DD" в timezone проекта
// (todayInTimezone); считаем на строках и UTC, без часового пояса браузера.

export function monthRange(today: string, offset: 0 | -1): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  // День 0 следующего месяца — последний день этого.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}
```

В `lib/business/dates.ts` после `formatDateTime`:

```ts
/** "01.10.2026" — дата момента (timestamptz) в timezone проекта, для списков. */
export function formatDateNumeric(isoTimestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";

  return `${part("day")}.${part("month")}.${part("year")}`;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/validation/archive-filters.test.ts lib/business/archive-periods.test.ts lib/business/dates.test.ts 2>&1 | tail -5`
Expected: PASS, `Tests  17 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/archive-filters.ts lib/validation/archive-filters.test.ts lib/business/archive-periods.ts lib/business/archive-periods.test.ts lib/business/dates.ts lib/business/dates.test.ts
git commit -m "feat: разбор фильтров архива, быстрые периоды, формат даты"
```

---

### Task 3: Вкладка «Архив» на странице «Заявки»

**Files:**
- Create: `app/(app)/[projectId]/tasks/archive-data.ts`
- Create: `app/(app)/[projectId]/tasks/archive-filters-form.tsx`
- Create: `app/(app)/[projectId]/tasks/archive-list.tsx`
- Create: `app/(app)/[projectId]/tasks/archive-tab.tsx`
- Modify: `app/(app)/[projectId]/tasks/page.tsx` (весь файл)

**Interfaces:**
- Consumes: Task 1 RPC; Task 2 `ArchiveFilters`, `parseArchiveFilters`, `archiveQuery`, `hasArchiveFilters`, `ARCHIVE_PAGE_SIZE`, `ARCHIVE_MAX_PAGE`, `ARCHIVE_QUERY_MAX`, `monthRange`, `formatDateNumeric`.
- Produces: `loadArchive(projectId: string, filters: ArchiveFilters): Promise<ArchiveResult>`; `type ArchiveTask = { id: string; title: string; status: TaskStatus; completedAt: string | null; categoryName: string | null; executorNames: string[] }`; `type ArchiveResult = { ok: true; tasks: ArchiveTask[]; hasMore: boolean } | { ok: false }`.

Логика этой задачи — в Task 1 и Task 2 (покрыта тестами); здесь серверные компоненты, проверка — tsc, eslint, build и браузер.

- [ ] **Step 1: `archive-data.ts`**

```ts
import type { TaskStatus } from "@/lib/business/task-status";
import { createClient } from "@/lib/supabase/server";
import { ARCHIVE_PAGE_SIZE, type ArchiveFilters } from "@/lib/validation/archive-filters";

// Загрузка вкладки «Архив» (public.search_archive_tasks, 0020). Только для серверного кода.

export type ArchiveTask = {
  id: string;
  title: string;
  status: TaskStatus;
  completedAt: string | null;
  categoryName: string | null;
  executorNames: string[];
};

export type ArchiveResult = { ok: true; tasks: ArchiveTask[]; hasMore: boolean } | { ok: false };

export async function loadArchive(projectId: string, filters: ArchiveFilters): Promise<ArchiveResult> {
  const supabase = await createClient();
  const limit = filters.page * ARCHIVE_PAGE_SIZE;

  // На строку больше, чем показываем, — так видно, есть ли продолжение.
  const { data, error } = await supabase.rpc("search_archive_tasks", {
    p_project_id: projectId,
    p_status: filters.status,
    p_query: filters.q || undefined,
    p_category_id: filters.category ?? undefined,
    p_executor_id: filters.executor ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_limit: limit + 1,
  });

  if (error) {
    console.error("loadArchive:", error);
    return { ok: false };
  }

  const rows = data ?? [];
  return {
    ok: true,
    hasMore: rows.length > limit,
    tasks: rows.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      // Сгенерированные типы не знают, что эти колонки nullable (left join, отменённые).
      completedAt: (r.completed_at as string | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      executorNames: r.executor_names ?? [],
    })),
  };
}
```

- [ ] **Step 2: `archive-filters-form.tsx`**

```tsx
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { monthRange } from "@/lib/business/archive-periods";
import { ARCHIVE_QUERY_MAX, archiveQuery, type ArchiveFilters } from "@/lib/validation/archive-filters";

const LINK_CLASS = "text-[12.5px] text-meta transition-colors duration-120 hover:text-ink";

/** Фильтры архива — обычная GET-форма: состояние в URL, страница строится на сервере. */
export function ArchiveFiltersForm({
  projectId,
  filters,
  categories,
  executors,
  today,
}: {
  projectId: string;
  filters: ArchiveFilters;
  categories: { id: string; name: string; is_archived: boolean }[];
  executors: { id: string; name: string; is_active: boolean }[];
  today: string;
}) {
  const base = `/${projectId}/tasks`;
  const hasPeriod = filters.from !== null || filters.to !== null;

  return (
    // key: после перехода по ссылке с другими фильтрами поля перемонтируются
    // и показывают значения нового URL, а не прежние.
    <form key={archiveQuery(filters)} method="get" action={base} role="search" className="flex flex-col gap-3">
      <input type="hidden" name="view" value="archive" />
      <Input
        type="search"
        name="q"
        defaultValue={filters.q}
        maxLength={ARCHIVE_QUERY_MAX}
        placeholder="Название или описание"
        aria-label="Поиск по названию или описанию"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NativeSelect name="status" aria-label="Статус" defaultValue={filters.status}>
          <option value="completed">Выполненные</option>
          <option value="cancelled">Отменённые</option>
          <option value="all">Все</option>
        </NativeSelect>
        <NativeSelect name="category" aria-label="Цех" defaultValue={filters.category ?? ""}>
          <option value="">Все цеха</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.is_archived ? `${c.name} (архив)` : c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="executor" aria-label="Исполнитель" defaultValue={filters.executor ?? ""}>
          <option value="">Все исполнители</option>
          {executors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.is_active ? e.name : `${e.name} (архив)`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
        <Label className="flex flex-col items-start gap-1 text-[12px] text-meta">
          Выполнена с
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Label>
        <Label className="flex flex-col items-start gap-1 text-[12px] text-meta">
          по
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={`${base}?${archiveQuery(filters, { ...monthRange(today, 0), page: 1 })}`} className={LINK_CLASS}>
          Этот месяц
        </Link>
        <Link href={`${base}?${archiveQuery(filters, { ...monthRange(today, -1), page: 1 })}`} className={LINK_CLASS}>
          Прошлый месяц
        </Link>
        {hasPeriod ? (
          <span className="text-[12px] text-meta-dim">Период — по дате выполнения, показаны только выполненные</span>
        ) : null}
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit">Найти</Button>
        <Link href={`${base}?view=archive`} className={LINK_CLASS}>
          Сбросить
        </Link>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `archive-list.tsx`**

```tsx
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { formatDateNumeric } from "@/lib/business/dates";
import { cn } from "@/lib/utils";
import { ARCHIVE_MAX_PAGE, archiveQuery, hasArchiveFilters, type ArchiveFilters } from "@/lib/validation/archive-filters";

import type { ArchiveResult } from "./archive-data";

export function ArchiveList({
  projectId,
  filters,
  result,
  timezone,
}: {
  projectId: string;
  filters: ArchiveFilters;
  result: ArchiveResult;
  timezone: string;
}) {
  if (!result.ok) {
    return (
      <p role="alert" className="text-[12.5px] text-status-alert-fg">
        Не удалось загрузить архив. Обновите страницу.
      </p>
    );
  }

  if (result.tasks.length === 0) {
    return (
      <EmptyState>
        {hasArchiveFilters(filters) ? "Ничего не найдено. Измените условия поиска." : "Выполненных заявок пока нет."}
      </EmptyState>
    );
  }

  const base = `/${projectId}/tasks`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col divide-y divide-line-subtle">
        {result.tasks.map((task) => {
          const meta = [task.categoryName, ...task.executorNames].filter(Boolean).join(" · ");
          const cancelled = task.status === "cancelled";
          return (
            <Link
              key={task.id}
              href={`${base}/${task.id}`}
              className="flex items-start justify-between gap-3 py-2 hover:bg-row-hover"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("break-words", cancelled && "text-meta line-through")}>{task.title}</span>
                {meta ? <span className="text-[12px] break-words text-meta">{meta}</span> : null}
              </span>
              <span className="shrink-0 text-[12px] text-meta">
                {task.completedAt ? formatDateNumeric(task.completedAt, timezone) : "Отменена"}
              </span>
            </Link>
          );
        })}
      </div>
      {result.hasMore ? (
        filters.page < ARCHIVE_MAX_PAGE ? (
          <Link
            href={`${base}?${archiveQuery(filters, { page: filters.page + 1 })}`}
            scroll={false}
            className="self-start text-[12.5px] text-meta transition-colors duration-120 hover:text-ink"
          >
            Показать ещё
          </Link>
        ) : (
          <p className="text-[12px] text-meta-dim">Уточните условия поиска</p>
        )
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: `archive-tab.tsx`**

```tsx
import { todayInTimezone } from "@/lib/business/dates";
import { createClient } from "@/lib/supabase/server";
import { parseArchiveFilters } from "@/lib/validation/archive-filters";

import { loadArchive } from "./archive-data";
import { ArchiveFiltersForm } from "./archive-filters-form";
import { ArchiveList } from "./archive-list";

export async function ArchiveTab({
  projectId,
  searchParams,
}: {
  projectId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = parseArchiveFilters(searchParams);
  const supabase = await createClient();

  // Справочники — вместе с архивными: старая работа делалась старыми цехами и людьми.
  const [{ data: project }, { data: categories }, { data: executors }, result] = await Promise.all([
    supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("project_id", projectId)
      .order("is_archived", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("executors")
      .select("id, name, is_active")
      .eq("project_id", projectId)
      .order("is_active", { ascending: false })
      .order("name", { ascending: true }),
    loadArchive(projectId, filters),
  ]);

  const timezone = project?.timezone ?? "Europe/Moscow";

  return (
    <>
      <ArchiveFiltersForm
        projectId={projectId}
        filters={filters}
        categories={categories ?? []}
        executors={executors ?? []}
        today={todayInTimezone(timezone)}
      />
      <ArchiveList projectId={projectId} filters={filters} result={result} timezone={timezone} />
    </>
  );
}
```

- [ ] **Step 5: `page.tsx` — вкладки, открытые без закрытых**

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canEditProject } from "@/lib/business/project-roles";
import { taskStatusLabel } from "@/lib/business/task-status";
import { getProjectRole } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { ArchiveTab } from "./archive-tab";
import { CreateTaskForm } from "./create-task-form";

export const metadata: Metadata = {
  title: "Заявки — Repair Planner",
};

// Сегменты как у переключателя недели на доске (docs/redesign.md §3).
const TAB_CLASS =
  "flex h-[30px] items-center px-[11px] text-[12.5px] font-medium whitespace-nowrap text-ink-soft transition-colors duration-120 not-last:border-r not-last:border-control-line hover:bg-[#F4F6FA] hover:text-ink";
const TAB_ACTIVE_CLASS = "bg-brand-surface text-brand hover:bg-brand-surface hover:text-brand";

export default async function TasksPage({ params, searchParams }: PageProps<"/[projectId]/tasks">) {
  const { projectId } = await params;
  const query = await searchParams;
  const isArchive = query.view === "archive";
  const base = `/${projectId}/tasks`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Заявки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <nav
            aria-label="Заявки"
            className="flex self-start overflow-hidden rounded-[7px] border border-control bg-surface"
          >
            <Link
              href={base}
              aria-current={isArchive ? undefined : "page"}
              className={cn(TAB_CLASS, !isArchive && TAB_ACTIVE_CLASS)}
            >
              Открытые
            </Link>
            <Link
              href={`${base}?view=archive`}
              aria-current={isArchive ? "page" : undefined}
              className={cn(TAB_CLASS, isArchive && TAB_ACTIVE_CLASS)}
            >
              Архив
            </Link>
          </nav>
          {isArchive ? (
            <ArchiveTab projectId={projectId} searchParams={query} />
          ) : (
            <OpenTasks projectId={projectId} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

async function OpenTasks({ projectId }: { projectId: string }) {
  const supabase = await createClient();
  const [role, { data: tasks }, { data: categories }, { data: queues }] = await Promise.all([
    getProjectRole(projectId),
    supabase
      .from("tasks")
      .select("id, title, status, categories(name)")
      .eq("project_id", projectId)
      // Выполненные и отменённые — во вкладке «Архив».
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  const open = tasks ?? [];

  return (
    <>
      {canEditProject(role) ? (
        <CreateTaskForm projectId={projectId} categories={categories ?? []} queues={queues ?? []} />
      ) : null}

      <div className="flex flex-col divide-y divide-line-subtle">
        {open.length === 0 ? (
          <EmptyState>Открытых заявок нет.</EmptyState>
        ) : (
          open.map((task) => (
            <Link
              key={task.id}
              href={`/${projectId}/tasks/${task.id}`}
              className="flex items-center justify-between gap-2 py-2 hover:bg-row-hover"
            >
              <span>{task.title}</span>
              <span className="flex items-center gap-2 text-[12px] text-meta">
                {task.categories ? <span>{task.categories.name}</span> : null}
                <span>{taskStatusLabel(task.status)}</span>
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Static checks**

Run: `npx tsc --noEmit && npx eslint . && npm run build 2>&1 | tail -5`
Expected: без ошибок; в выводе build маршрут `/[projectId]/tasks` динамический (`ƒ`).

- [ ] **Step 7: Browser check (preview `dev`, проект локального тестового пользователя)**

Подготовка (локально, postgres, тестовые данные): у двух заявок проекта статус `completed` с разными `completed_at` в сентябре и октябре, одна `cancelled`, у одной исполнитель и цех.

На 1280 и 375 проверить и записать результат:
1. «Заявки» открывается на вкладке «Открытые»; закрытых заявок в ней нет; форма создания на месте.
2. «Архив»: выполненные, свежие сверху, справа дата `ДД.ММ.ГГГГ`.
3. Поиск по слову из названия и из описания; запрос `насос, (ремонт)` — пусто без ошибки.
4. Статус «Отменённые» → отменённая, «Отменена» справа, зачёркнута.
5. Цех, исполнитель — каждый сужает список.
6. «Этот месяц» → поля «с»/«по» показывают даты месяца (Review Focus 1), видна подпись про период, отменённых нет при статусе «Все».
7. «Сбросить» → все поля пустые, статус «Выполненные».
8. Временно `ARCHIVE_PAGE_SIZE = 1` в `archive-filters.ts` → «Показать ещё» добавляет строку и не прокручивает наверх; вернуть 50.
9. Строка ведёт в карточку заявки.
10. На 375 нет горизонтальной прокрутки (`document.documentElement.scrollWidth === innerWidth`).
11. Консоль без ошибок; ручной URL `?view=archive&page=abc&category=xyz&from=2026-13-45` открывается без ошибки.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/[projectId]/tasks/"
git commit -m "feat: вкладка «Архив» с поиском на странице «Заявки»"
```

---

### Task 4: Документация

**Files:**
- Modify: `docs/product-requirements.md`, `docs/architecture.md`, `docs/roadmap.md`

- [ ] **Step 1: `docs/product-requirements.md`**

Найти раздел про заявки (`grep -n "Заявки" docs/product-requirements.md`) и добавить подраздел:

```markdown
**Архив и поиск** (2026-10-08). Страница «Заявки» — две вкладки: «Открытые» и «Архив». В архиве выполненные и отменённые заявки, свежие сверху (выполненные — по дате выполнения, отменённые — по последнему изменению).

* Фильтры: текст (название и описание, без учёта регистра, буквально), статус («Выполненные» — по умолчанию, «Отменённые», «Все»), цех и исполнитель (включая архивных), период «с … по …» включительно в timezone проекта, быстрые «Этот месяц» и «Прошлый месяц».
* Период — по дате выполнения. У отменённой заявки её нет, поэтому при заданном периоде показываются только выполненные.
* Фильтры хранятся в адресе страницы. По 50 строк, «Показать ещё» — до 1000.
```

- [ ] **Step 2: `docs/architecture.md`**

Найти описание страницы задач (`grep -n "tasks" docs/architecture.md`) и добавить:

```markdown
* `/[projectId]/tasks` — вкладки «Открытые» и «Архив» (`?view=archive`). Архив — Server Component: GET-форма фильтров, разбор `searchParams` в `lib/validation/archive-filters.ts`, загрузка `tasks/archive-data.ts` → RPC `search_archive_tasks` (0020). Клиентского JS у вкладки нет.
```

- [ ] **Step 3: `docs/roadmap.md`**

- `8. Фильтры и поиск по задачам, архив выполненных работ.` → `8. ~~Фильтры и поиск по задачам, архив выполненных работ~~ — архив и поиск сделаны (0020); фильтры открытых заявок — п. 14.`
- В конец списка «После MVP» добавить:
  ```markdown
  16. Поиск по материалу в архиве.
  17. Отчёт «выполненные работы за период» с выгрузкой.
  18. Триграммный индекс (pg_trgm) для поиска по тексту — при тысячах заявок.
  19. Дата отмены заявки (`cancelled_at`), чтобы отменённые попадали в фильтр периода.
  ```
- Пункт 14 переименовать: `14. Фильтры открытых заявок на странице «Заявки» (цех, исполнитель, статус, очередь).`

- [ ] **Step 4: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint . && npm test 2>&1 | grep -E "Test Files|Tests " && supabase test db 2>&1 | tail -3`
Expected: всё зелёное; vitest 167 (152 + 15), pgTAP 240.

```bash
git add docs/product-requirements.md docs/architecture.md docs/roadmap.md
git commit -m "docs: архив выполненных работ и поиск"
```
