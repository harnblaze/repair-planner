-- Смена дня для задачи с историей (0029): RPC move_task_schedule.
-- Будущие даты — неделя 2099-01-05 (пн) … 2099-01-09 (пт), прошлые — 2020-01-06 (пн) … 2020-01-10 (пт).
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'move-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'move-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'move-viewer-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.tasks (id, project_id, title, status) values
  ('f3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Отложена и продолжена', 'in_progress'),
  ('f3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Перенесена', 'in_progress'),
  ('f3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Прошлое', 'in_progress'),
  ('f3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Прошлое без слияния', 'in_progress'),
  ('f3000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Чужая', 'in_progress');

insert into public.task_schedule (project_id, task_id, work_date, carried_over, postponed) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000001', '2099-01-05', false, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000001', '2099-01-06', true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000002', '2099-01-05', false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000002', '2099-01-06', true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000003', '2020-01-06', false, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000003', '2020-01-08', true,  false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000004', '2020-01-06', false, false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3000000-0000-0000-0000-000000000004', '2020-01-07', true,  false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f3000000-0000-0000-0000-00000000000b', '2099-01-05', false, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f3000000-0000-0000-0000-00000000000b', '2099-01-06', true,  false);

-- Расписание задачи одной строкой: дата:carried_over:postponed по датам.
create function public._test_days(p_task uuid) returns text language sql as $$
  select string_agg(work_date::text || ':' || carried_over::text || ':' || postponed::text, ',' order by work_date)
  from public.task_schedule where task_id = p_task
$$;

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 1–2. Отложенная и продолженная задача переносится позже: история не трогается
select lives_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000001', '2099-01-06', '2099-01-08', 0) $$,
  'the current day of a postponed-and-resumed task moves to a later day'
);
select is(
  public._test_days('f3000000-0000-0000-0000-000000000001'),
  '2099-01-05:false:true,2099-01-08:true:false',
  'the moved day keeps carried_over, the postponed history day stays'
);

-- 3. Раньше последнего дня истории — нельзя
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000001', '2099-01-08', '2099-01-02', 0) $$,
  null::char(5), 'date_before_history',
  'a task with history cannot move before its last history day'
);

-- 4. День истории между днями не перетаскивается
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000001', '2099-01-05', '2099-01-07', 0) $$,
  null::char(5), 'task_has_history',
  'a history day cannot move to another day'
);

-- 5–7. На день, когда задачу отложили, — слияние: «Отложена» снимается
select lives_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000001', '2099-01-08', '2099-01-05', 0) $$,
  'moving the current day onto the postponed day merges them'
);
select is(
  public._test_days('f3000000-0000-0000-0000-000000000001'),
  '2099-01-05:false:false',
  'after the merge only the former history day remains, no longer postponed'
);
select is(
  (select planned_date from public.tasks where id = 'f3000000-0000-0000-0000-000000000001'),
  '2099-01-05'::date,
  'planned_date follows the merged day'
);

-- 8–9. Перенесённая (без паузы) задача тоже переносится и сливается с предыдущим днём
select lives_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000002', '2099-01-06', '2099-01-09', 0) $$,
  'a carried-over task moves to a later day'
);
select move_task_schedule('f3000000-0000-0000-0000-000000000002', '2099-01-09', '2099-01-05', 0);
select is(
  public._test_days('f3000000-0000-0000-0000-000000000002'),
  '2099-01-05:false:false',
  'a carried-over task merges back into its previous day'
);

-- 10. Выходной отклоняется и для задачи с историей
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000003', '2020-01-08', '2020-01-11', 0) $$,
  null::char(5), 'not_working_day',
  'a task with history cannot move to a weekend'
);

-- 11–12. Прошедший текущий день с днём истории не сливается
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000003', '2020-01-08', '2020-01-06', 0) $$,
  null::char(5), 'day_already_passed',
  'a past current day cannot merge into the history day'
);
select is(
  public._test_days('f3000000-0000-0000-0000-000000000003'),
  '2020-01-06:false:true,2020-01-08:true:false',
  'a rejected merge leaves the schedule unchanged'
);

-- 13. Прошедший текущий день переносится позже истории (как и однодневная задача)
select lives_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000004', '2020-01-07', '2020-01-09', 0) $$,
  'a past current day moves to a later day'
);

-- 14. Порядок внутри дня у задачи с историей по-прежнему меняется
select lives_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000004', '2020-01-06', '2020-01-06', 0) $$,
  'a history day can still be reordered within its day'
);

-- 15. Чужой проект
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-00000000000b', '2099-01-06', '2099-01-05', 0) $$,
  null::char(5), 'task_not_found',
  'owner A cannot move a task of project B'
);

reset role;

-- 16. Задача B не изменилась
select is(
  public._test_days('f3000000-0000-0000-0000-00000000000b'),
  '2099-01-05:false:true,2099-01-06:true:false',
  'the task of project B is unchanged'
);

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 17. Viewer не меняет день
select throws_ok(
  $$ select move_task_schedule('f3000000-0000-0000-0000-000000000004', '2020-01-09', '2020-01-10', 0) $$,
  null::char(5), 'task_not_found',
  'a viewer cannot move a task'
);

reset role;

-- 18. anon не вызывает функцию
select ok(
  not has_function_privilege('anon', 'public.move_task_schedule(uuid, date, date, integer)', 'execute'),
  'anon cannot execute move_task_schedule'
);

select * from finish();

rollback;
