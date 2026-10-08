-- Архив выполненных работ и поиск (0020, дата отмены — 0023, материал — 0024): public.search_archive_tasks.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(42);

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

-- Отменена 25.09 (13:00 МСК) — между «Сваркой рамы» и выполненными 30.09.
insert into public.tasks (id, project_id, title, status, cancelled_at) values
  ('f2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Покраска_стен', 'cancelled',
   '2026-09-25 10:00+00');

insert into public.tasks (id, project_id, title, status) values
  ('f2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Насосная станция', 'new');

insert into public.task_executors (task_id, executor_id, project_id) values
  ('f2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Расход: электрод — в «Ремонт насоса» 2.5 и в отменённой «Покраске», краска — в «Замене ворот».
insert into public.materials (id, project_id, name, unit, current_balance) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрод', 'кг', 100),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Краска', 'л', 100),
  ('a1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Электрод B', 'кг', 100);

insert into public.task_materials (project_id, task_id, material_id, quantity) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 2.5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 3),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f2000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-00000000000b', 4);

-- 1
select has_function('public', 'search_archive_tasks',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'date', 'date', 'integer', 'uuid'],
  'search_archive_tasks exists');

-- 26-28, 33-35. Дата отмены (0023): есть ровно у отменённых, ставит и снимает триггер
select has_column('public', 'tasks', 'cancelled_at', 'tasks.cancelled_at exists');

select ok(
  exists (select 1 from pg_constraint
            where conname = 'tasks_cancelled_at_matches_status' and conrelid = 'public.tasks'::regclass),
  'CHECK keeps cancelled_at in sync with status'
);

-- Старый код ставит статус без даты — триггер проставляет её сам.
insert into public.tasks (id, project_id, title, status) values
  ('f2000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Отмена без даты', 'cancelled');
select ok(
  (select cancelled_at is not null from public.tasks where id = 'f2000000-0000-0000-0000-0000000000c1'),
  'insert as cancelled without a date gets cancelled_at'
);

update public.tasks set status = 'new' where id = 'f2000000-0000-0000-0000-0000000000c1';
select ok(
  (select cancelled_at is null from public.tasks where id = 'f2000000-0000-0000-0000-0000000000c1'),
  'leaving cancelled clears cancelled_at'
);

update public.tasks set status = 'cancelled' where id = 'f2000000-0000-0000-0000-0000000000c1';
select ok(
  (select cancelled_at is not null from public.tasks where id = 'f2000000-0000-0000-0000-0000000000c1'),
  'update to cancelled without a date sets cancelled_at'
);

-- Правка отменённой заявки дату отмены не трогает.
update public.tasks set title = 'Отмена без даты (правка)' where id = 'f2000000-0000-0000-0000-000000000003';
select is(
  (select cancelled_at from public.tasks where id = 'f2000000-0000-0000-0000-000000000003'),
  '2026-09-25 10:00+00'::timestamptz,
  'editing a cancelled task keeps cancelled_at'
);
update public.tasks set title = 'Покраска_стен' where id = 'f2000000-0000-0000-0000-000000000003';

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

-- 4. Все — по дате закрытия: выполненные по completed_at, отменённые по cancelled_at
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all')),
  array['Замена ворот', 'Ремонт насоса', 'Покраска_стен', 'Сварка рамы'],
  'all: ordered by completion or cancellation date'
);

-- 5. Период при 'all' включает и отменённые — по дате отмены
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_from => '2026-08-01', p_to => '2026-10-31')),
  array['Замена ворот', 'Ремонт насоса', 'Покраска_стен', 'Сварка рамы'],
  'period with all includes cancelled by cancelled_at'
);

-- 29. Отменённые за период — по дате отмены
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cancelled',
    p_from => '2026-09-01', p_to => '2026-09-30')),
  array['Покраска_стен'],
  'cancelled within the period'
);

-- 30
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cancelled',
    p_from => '2026-10-01')),
  array[]::text[],
  'cancelled outside the period is excluded'
);

-- 31. «Выполненные» с периодом отменённые не включают
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_from => '2026-08-01', p_to => '2026-10-31')),
  array['Замена ворот', 'Ремонт насоса', 'Сварка рамы'],
  'completed with a period excludes cancelled'
);

-- 32. Строка отменённой несёт дату отмены
select row_eq(
  $$ select completed_at, cancelled_at from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'cancelled') $$,
  row(null::timestamptz, '2026-09-25 10:00+00'::timestamptz),
  'cancelled row carries cancelled_at'
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

-- 36. Материал — только заявки с его расходом, расход в строке
select results_eq(
  $$ select title, material_quantity from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
     p_material_id => 'a1000000-0000-0000-0000-000000000001') $$,
  $$ values ('Ремонт насоса'::text, 2.5::numeric), ('Покраска_стен'::text, 1::numeric) $$,
  'material filter keeps tasks that used it and carries the quantity'
);

-- 37. Со статусом
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'completed',
    p_material_id => 'a1000000-0000-0000-0000-000000000001')),
  array['Ремонт насоса'],
  'material filter combines with status'
);

-- 38. С периодом: «Ремонт насоса» закрыт 30.09 МСК, «Покраска» — 25.09
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_material_id => 'a1000000-0000-0000-0000-000000000001', p_from => '2026-09-26')),
  array['Ремонт насоса'],
  'material filter combines with the period'
);

-- 39. Без фильтра по материалу количество пустое
select is(
  (select count(*) from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all')
    where material_quantity is not null),
  0::bigint,
  'no material filter gives null quantity'
);

-- 40. Материал без расхода в архиве — пусто
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_material_id => gen_random_uuid())),
  array[]::text[],
  'unknown material gives an empty result'
);

-- 41. Материал чужого проекта — пусто
select is(
  array(select title from public.search_archive_tasks('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'all',
    p_material_id => 'a1000000-0000-0000-0000-00000000000b')),
  array[]::text[],
  'material of another project gives an empty result'
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

-- 42. Чужой проект и его материал — пусто, расход не раскрывается
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;
select is(
  (select count(*) from public.search_archive_tasks('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'all',
    p_material_id => 'a1000000-0000-0000-0000-00000000000b')),
  0::bigint,
  'foreign project with its material stays empty'
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
  not has_function_privilege('anon', 'public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int, uuid)', 'execute'),
  'anon cannot execute search_archive_tasks'
);

select * from finish();

rollback;
