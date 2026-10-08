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
