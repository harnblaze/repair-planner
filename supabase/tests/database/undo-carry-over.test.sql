-- Отмена переноса на следующий рабочий день (0021): RPC undo_carry_over.
-- Даты — относительно «сегодня» в timezone проекта. Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'undo-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'undo-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'undo-viewer-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.tasks (id, project_id, title, status) values
  ('f2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сегодня', 'in_progress'),
  ('f2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Будущее', 'in_progress'),
  ('f2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Один день', 'planned'),
  ('f2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'После отложенной', 'in_progress'),
  ('f2000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Прошлое', 'in_progress'),
  ('f2000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Для viewer', 'in_progress'),
  ('f2000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Чужая', 'in_progress');

insert into public.tasks (id, project_id, title, status, completed_at) values
  ('f2000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Закрытая', 'completed', now());

-- d — «сегодня» проекта A; timezone у A и B одинаковый (по умолчанию).
create temporary table _d as
  select (now() at time zone p.timezone)::date as d
  from public.projects p where p.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
grant select on _d to authenticated;

-- Сдвиги от «сегодня» могут попасть на выходные: проверку рабочего дня (0013)
-- на время фикстур выключаем — отмена переноса от дня недели не зависит.
alter table public.task_schedule disable trigger task_schedule_check_working_day;

insert into public.task_schedule (project_id, task_id, work_date, carried_over, postponed)
select v.project_id::uuid, v.task_id::uuid, (select d from _d) + v.shift, v.carried, v.postponed
from (values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000001', -1, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000001',  0, true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000002',  0, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000002',  2, true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000003',  0, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000004', -3, false, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000004',  0, true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000005', -2, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000005', -1, true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000006', -1, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000006',  0, true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000007',  0, false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2000000-0000-0000-0000-000000000007',  1, true,  false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f2000000-0000-0000-0000-00000000000b',  0, false, false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f2000000-0000-0000-0000-00000000000b',  1, true,  false)
) as v(project_id, task_id, shift, carried, postponed);

alter table public.task_schedule enable trigger task_schedule_check_working_day;

-- ================= Структура =================

-- 1
select has_function('public', 'undo_carry_over', array['uuid'], 'undo_carry_over(uuid) exists');

-- 2
select ok(
  not has_function_privilege('anon', 'public.undo_carry_over(uuid)', 'execute'),
  'anon cannot execute undo_carry_over'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3-5. Перенос на сегодня отменяется в тот же день: предыдущий день снова последний
select is(
  public.undo_carry_over('f2000000-0000-0000-0000-000000000001'),
  (select d from _d) - 1,
  'undo returns the previous work date when the carried day is today'
);
select is(
  (select planned_date from public.tasks where id = 'f2000000-0000-0000-0000-000000000001'),
  (select d from _d) - 1,
  'planned_date is the previous day after undo'
);
select is(
  (select count(*)::int from public.task_schedule where task_id = 'f2000000-0000-0000-0000-000000000001'),
  1,
  'undo deletes only the carried day'
);

-- 6-7. Перенос в будущее тоже отменяется; статус не меняется
select is(
  public.undo_carry_over('f2000000-0000-0000-0000-000000000002'),
  (select d from _d),
  'undo of a carry-over into the future returns the previous day'
);
select is(
  (select status::text from public.tasks where id = 'f2000000-0000-0000-0000-000000000002'),
  'in_progress',
  'undo keeps the task status'
);

-- 8. Повторная отмена: переносов больше нет
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000002') $$,
  'P0001', 'nothing_to_undo',
  'second undo has nothing to undo'
);

-- 9. Один день без переноса
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000003') $$,
  'P0001', 'nothing_to_undo',
  'a single planned day is not a carry-over'
);

-- 10. Перед последним днём — отложенный: это повторное планирование, не перенос
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000004') $$,
  'P0001', 'nothing_to_undo',
  'a day planned after a postponed day is not a carry-over'
);

-- 11-12. Перенесённый день уже прошёл — отмена запрещена, расписание не тронуто
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000005') $$,
  'P0001', 'carry_over_too_old',
  'a carry-over into a past day cannot be undone'
);
select is(
  (select count(*)::int from public.task_schedule where task_id = 'f2000000-0000-0000-0000-000000000005'),
  2,
  'rejected undo keeps the schedule'
);

-- 13. Закрытая заявка
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000006') $$,
  'P0001', 'task_closed',
  'undo rejects a closed task'
);

-- 14. Заявка чужого проекта недоступна
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-00000000000b') $$,
  'P0001', 'task_not_found',
  'undo rejects a task of a project without access'
);

reset role;

-- 15. Чужое расписание не изменилось
select is(
  (select count(*)::int from public.task_schedule where task_id = 'f2000000-0000-0000-0000-00000000000b'),
  2,
  'another project schedule is untouched'
);

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 16. Viewer видит заявку, но отменить перенос не может
select is(
  (select count(*)::int from public.tasks where id = 'f2000000-0000-0000-0000-000000000007'),
  1,
  'viewer sees the task'
);
select throws_ok(
  $$ select public.undo_carry_over('f2000000-0000-0000-0000-000000000007') $$,
  'P0001', 'task_not_found',
  'viewer cannot undo a carry-over'
);

reset role;

-- 18
select is(
  (select count(*)::int from public.task_schedule where task_id = 'f2000000-0000-0000-0000-000000000007'),
  2,
  'viewer attempt keeps the schedule'
);

select * from finish();

rollback;
