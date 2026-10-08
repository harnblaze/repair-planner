-- Снятие задачи с плана возвращает статус planned → new (0028):
-- return_task_to_backlog (перетаскивание в «Текущие заявки») и
-- set_task_planned_date(null) (очистка даты в карточке).
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(8);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'unplan-owner-a@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A');

insert into public.tasks (id, project_id, title, status) values
  ('f5000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Запланирована → доска', 'planned'),
  ('f5000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Новая → доска', 'new'),
  ('f5000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'В работе → доска', 'in_progress'),
  ('f5000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Запланирована → карточка', 'planned'),
  ('f5000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'В работе → карточка', 'in_progress'),
  ('f5000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Приостановлена → карточка', 'paused');

-- 2020-01-06 и 2020-01-07 — понедельник и вторник (рабочие дни, в прошлом).
insert into public.task_schedule (project_id, task_id, work_date) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000001', '2020-01-06'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000002', '2020-01-06'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000003', '2020-01-07'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000004', '2020-01-06'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000005', '2020-01-07'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000006', '2020-01-07');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- ================= return_task_to_backlog =================

select return_task_to_backlog('f5000000-0000-0000-0000-000000000001');
select return_task_to_backlog('f5000000-0000-0000-0000-000000000002');
select return_task_to_backlog('f5000000-0000-0000-0000-000000000003');

-- 1
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000001'),
  'new',
  'return_task_to_backlog moves a planned task back to new'
);

-- 2
select is(
  (select planned_date from public.tasks where id = 'f5000000-0000-0000-0000-000000000001'),
  null::date,
  'the returned planned task has no plan'
);

-- 3
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000002'),
  'new',
  'return_task_to_backlog keeps a new task new'
);

-- 4
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000003'),
  'in_progress',
  'return_task_to_backlog keeps a task in progress in progress'
);

-- ================= set_task_planned_date(null) =================

select set_task_planned_date('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000004', null);
select set_task_planned_date('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000005', null);
select set_task_planned_date('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f5000000-0000-0000-0000-000000000006', null);

-- 5
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000004'),
  'new',
  'clearing the planned date moves a planned task back to new'
);

-- 6
select is(
  (select count(*) from public.task_schedule where task_id = 'f5000000-0000-0000-0000-000000000004'),
  0::bigint,
  'clearing the planned date removes the schedule'
);

-- 7
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000005'),
  'in_progress',
  'clearing the planned date keeps a task in progress in progress'
);

-- 8
select is(
  (select status::text from public.tasks where id = 'f5000000-0000-0000-0000-000000000006'),
  'paused',
  'clearing the planned date keeps a paused task paused'
);

reset role;

select * from finish();

rollback;
