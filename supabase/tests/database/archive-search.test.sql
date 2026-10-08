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
