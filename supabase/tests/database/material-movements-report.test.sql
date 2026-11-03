-- Движение материалов за период (0041): public.material_movements_by_period.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A (Europe/Moscow), B — владелец проекта B.

insert into auth.users (id, email) values
  ('41111111-1111-1111-1111-111111111111', 'period-owner-a@example.com'),
  ('42222222-2222-2222-2222-222222222222', 'period-owner-b@example.com');

insert into public.projects (id, owner_id, name, timezone) values
  ('a4000000-0000-4000-8000-00000000000a', '41111111-1111-1111-1111-111111111111', 'Project A', 'Europe/Moscow'),
  ('b4000000-0000-4000-8000-00000000000b', '42222222-2222-2222-2222-222222222222', 'Project B', 'Europe/Moscow');

-- Остатки выставлены «как сейчас»: у «Электрода» 10 − 4 + 2 + 5 = 13.
insert into public.materials (id, project_id, name, unit, current_balance) values
  ('c4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000000a', 'Электрод', 'кг', 13),
  ('c4000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-00000000000a', 'Краска', 'л', 7),
  ('c4000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-00000000000a', 'Диск', 'шт', 3),
  ('c4000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-00000000000b', 'Чужой материал', 'шт', 1);

-- Расход в журнале требует заявку (check в 0005) — заводим одну.
insert into public.tasks (id, project_id, title, status) values
  ('d4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-00000000000a', 'Ремонт насоса', 'in_progress');

-- Границы периода — 2026-10-01..2026-10-31 по Москве (UTC+3):
--   приход ровно в начале (01.10 00:00) — попадает;
--   расход ровно в конце (31.10 23:59) — попадает;
--   приход 01.11 00:00 — уже после периода, в остаток на конец не входит;
--   приход 30.09 23:59 — до периода, в отчёт не входит.
insert into public.material_movements (project_id, material_id, kind, quantity, occurred_at, task_id) values
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001', 'receipt', 10, '2026-10-01 00:00+03', null),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001', 'consumption', -4, '2026-10-31 23:59+03', 'd4000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001', 'adjustment', 2, '2026-10-15 12:00+03', null),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001', 'receipt', 5, '2026-11-01 00:00+03', null),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000004', 'receipt', 3, '2026-09-30 23:59+03', null),
  ('b4000000-0000-4000-8000-00000000000b', 'c4000000-0000-4000-8000-000000000003', 'receipt', 1, '2026-10-10 12:00+03', null);

select has_function(
  'public', 'material_movements_by_period', array['uuid', 'date', 'date'],
  'material_movements_by_period exists'
);

select ok(
  not has_function_privilege('anon', 'public.material_movements_by_period(uuid, date, date)', 'execute'),
  'anon cannot execute material_movements_by_period'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '41111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Только материалы проекта A: чужие не видны, материал без движений — виден.
select is(
  (select count(*) from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')),
  3::bigint,
  'only own project materials, including the one without movements'
);

-- 4. Приход за период.
select is(
  (select receipt from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Электрод'),
  10::numeric,
  'receipt is summed inside the period'
);

-- 5. Расход — положительным числом, хотя в журнале он отрицательный.
select is(
  (select consumption from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Электрод'),
  4::numeric,
  'consumption is positive even though the journal stores it negative'
);

-- 6. Корректировка сохраняет знак.
select is(
  (select adjustment from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Электрод'),
  2::numeric,
  'adjustment keeps its sign'
);

-- 7. Остаток на конец: 13 − 5 (приход после периода) = 8.
select is(
  (select balance_at_end from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Электрод'),
  8::numeric,
  'balance_at_end rolls the current balance back by later movements'
);

-- 8. Последнее движение — внутри периода (31.10 23:59 МСК = 20:59 UTC), а не ноябрьское.
select is(
  (select last_moved_at from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Электрод'),
  '2026-10-31 20:59+00'::timestamptz,
  'last_moved_at is the latest movement inside the period'
);

-- 9. Материал без движений: нули и пустая дата, но остаток настоящий.
select is(
  (select format('%s|%s|%s|%s|%s', receipt::int, consumption::int, adjustment::int, balance_at_end::int,
                 coalesce(last_moved_at::text, '—'))
     from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Краска'),
  '0|0|0|7|—',
  'material without movements: zeros, its balance and null date'
);

-- 10. Движение до периода в отчёт периода не попадает.
select is(
  (select row(receipt, consumption)::text
     from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Диск'),
  row(0, 0)::text,
  'movement before the period is not counted'
);

-- 11. Чужой материал не попадает в отчёт проекта A.
select is(
  (select count(*) from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')
    where name = 'Чужой материал'),
  0::bigint,
  'material of another project is not visible'
);

-- 12. Порядок: больше всего израсходовано — первым.
select is(
  (select name from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31') limit 1),
  'Электрод',
  'rows are ordered by consumption descending'
);

reset role;

-- ================= Чужой проект =================

select set_config('request.jwt.claim.sub', '42222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 13. Владелец B не видит отчёт проекта A.
select is(
  (select count(*) from public.material_movements_by_period('a4000000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31')),
  0::bigint,
  'owner of another project sees nothing'
);

reset role;

select * from finish();

rollback;
