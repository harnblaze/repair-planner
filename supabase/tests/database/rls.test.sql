-- RLS и материальные операции: изоляция пользователей и атомарность.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(39);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@example.com');

-- ================= Пользователь A: проект A и его данные =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A');

insert into public.categories (id, project_id, name) values
  ('c0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Category A');

insert into public.materials (id, project_id, name, unit, current_balance, minimum_balance) values
  ('d0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Material A', 'кг', 10, 2);

insert into public.tasks (id, project_id, title, category_id) values
  ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A', 'c0000000-0000-0000-0000-00000000000a');

-- ================= Пользователь B: проект B и его данные =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

insert into public.projects (id, owner_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.materials (id, project_id, name, unit, current_balance, minimum_balance) values
  ('d0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Material B', 'кг', 5, 1);

-- ================= Снова пользователь A: проверки изоляции и бизнес-правил =================

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 1. Профили изолированы
select is(
  (select count(*) from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  0::bigint,
  'user A cannot select user B profile'
);

-- 2. Проекты изолированы на SELECT
select is(
  (select count(*) from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'user A cannot select project B'
);

-- 3. Проекты изолированы на UPDATE
with upd as (
  update public.projects set name = 'hacked' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id
)
select is((select count(*) from upd), 0::bigint, 'user A cannot update project B');

-- 4. Проекты изолированы на DELETE
with del as (
  delete from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id
)
select is((select count(*) from del), 0::bigint, 'user A cannot delete project B');

-- 5. Материалы изолированы на SELECT
select is(
  (select count(*) from public.materials where id = 'd0000000-0000-0000-0000-00000000000b'),
  0::bigint,
  'user A cannot select material from project B'
);

-- 6. Составной FK не даёт связать задачу проекта A с материалом проекта B
select throws_ok(
  $$ insert into public.task_materials (project_id, task_id, material_id, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000b', 1) $$,
  null::char(5), null,
  'cross-project material_id is rejected by the composite foreign key'
);

-- 7. current_balance нельзя менять напрямую
select throws_ok(
  $$ update public.materials set current_balance = 999 where id = 'd0000000-0000-0000-0000-00000000000a' $$,
  null::char(5), null,
  'current_balance cannot be updated directly by a client'
);

-- 8. material_movements нельзя писать напрямую
select throws_ok(
  $$ insert into public.material_movements (project_id, material_id, kind, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-0000-0000-00000000000a', 'adjustment', 1) $$,
  null::char(5), null,
  'material_movements has no insert policy for clients'
);

-- 9-10. Атомарное списание при INSERT task_materials
insert into public.task_materials (id, project_id, task_id, material_id, quantity) values
  ('f0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 3);

select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-00000000000a'),
  7::numeric,
  'consumption reduces material balance by the consumed quantity'
);

select is(
  (select count(*) from public.material_movements
     where material_id = 'd0000000-0000-0000-0000-00000000000a' and kind = 'consumption' and quantity = -3),
  1::bigint,
  'consumption movement is recorded in the journal'
);

-- 11-12. Атомарная корректировка при UPDATE task_materials
update public.task_materials set quantity = 5 where id = 'f0000000-0000-0000-0000-00000000000a';

select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-00000000000a'),
  5::numeric,
  'updating the consumed quantity adjusts the balance by the delta'
);

select is(
  (select count(*) from public.material_movements
     where material_id = 'd0000000-0000-0000-0000-00000000000a' and kind = 'adjustment' and quantity = -2),
  1::bigint,
  'quantity update is recorded as an adjustment movement'
);

-- 13-14. Атомарная корректировка при DELETE task_materials
delete from public.task_materials where id = 'f0000000-0000-0000-0000-00000000000a';

select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-00000000000a'),
  10::numeric,
  'deleting the consumption line returns the material to its original balance'
);

select is(
  (select count(*) from public.material_movements
     where material_id = 'd0000000-0000-0000-0000-00000000000a' and kind = 'adjustment' and quantity = 5),
  1::bigint,
  'deleting the consumption line is recorded as a compensating adjustment'
);

-- 15. planned_date нельзя менять напрямую
select throws_ok(
  $$ update public.tasks set planned_date = current_date where id = 'e0000000-0000-0000-0000-00000000000a' $$,
  null::char(5), null,
  'planned_date cannot be updated directly by a client'
);

-- 16. task_schedule пересчитывает planned_date
insert into public.task_schedule (project_id, task_id, work_date) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000a', current_date);

select is(
  (select planned_date from public.tasks where id = 'e0000000-0000-0000-0000-00000000000a'),
  current_date,
  'scheduling a work day recalculates the cached planned_date'
);

-- 17. Системный список нельзя удалить
with del as (
  delete from public.board_lists
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and is_system returning id
)
select is((select count(*) from del), 0::bigint, 'system board lists cannot be deleted');

-- 18. RPC приёма материала увеличивает остаток
select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'receipt', 4, 'приход');

select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-00000000000a'),
  14::numeric,
  'record_material_movement receipt increases the balance'
);

-- 19. RPC не принимает kind = consumption
select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'consumption', 1, null) $$,
  null::char(5), null,
  'record_material_movement rejects consumption movements'
);

-- ================= Drag-and-drop: RPC перемещения (0008) =================

insert into public.tasks (id, project_id, title) values
  ('e0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task C'),
  ('e0000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task D');

-- 20. Из «Текущих заявок» в день: planned_date и статус new → planned
select plan_task_on_day('e0000000-0000-0000-0000-00000000000c', '2020-01-06', null);

select is(
  (select planned_date::text || ':' || status::text from public.tasks where id = 'e0000000-0000-0000-0000-00000000000c'),
  '2020-01-06:planned',
  'plan_task_on_day schedules the task and moves status new to planned'
);

-- 21. Выходной отклоняется
select throws_ok(
  $$ select plan_task_on_day('e0000000-0000-0000-0000-00000000000d', '2020-01-11', null) $$,
  null::char(5), 'not_working_day',
  'plan_task_on_day rejects weekends'
);

-- 22. Однодневная задача меняет день
select move_task_schedule('e0000000-0000-0000-0000-00000000000c', '2020-01-06', '2020-01-07', 0);

select is(
  (select planned_date from public.tasks where id = 'e0000000-0000-0000-0000-00000000000c'),
  '2020-01-07'::date,
  'move_task_schedule moves a single-day task to another day'
);

-- 23. Возврат незапущенной задачи снимает весь план
select is(
  return_task_to_backlog('e0000000-0000-0000-0000-00000000000c'),
  false,
  'return_task_to_backlog reports no history for a task that was not started'
);

select is(
  (select count(*) from public.task_schedule where task_id = 'e0000000-0000-0000-0000-00000000000c'),
  0::bigint,
  'returning a not-started task removes all its schedule days'
);

-- 24. Задача в работе: прошедшие дни остаются историей, будущие удаляются
update public.tasks set status = 'in_progress' where id = 'e0000000-0000-0000-0000-00000000000c';

insert into public.task_schedule (project_id, task_id, work_date, carried_over) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000c', '2020-01-06', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000c', '2020-01-07', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000c', '2099-01-05', true);

select is(
  return_task_to_backlog('e0000000-0000-0000-0000-00000000000c'),
  true,
  'return_task_to_backlog keeps history for a task in progress'
);

select is(
  (select string_agg(work_date::text || ':' || postponed::text, ',' order by work_date)
     from public.task_schedule where task_id = 'e0000000-0000-0000-0000-00000000000c'),
  '2020-01-06:false,2020-01-07:true',
  'past days stay as history, the last one is marked postponed, future days are removed'
);

select is(
  (select planned_date from public.tasks where id = 'e0000000-0000-0000-0000-00000000000c'),
  null::date,
  'a postponed task has no planned_date and is back in the backlog'
);

-- 25. Возврат к отложенной задаче не раньше последнего дня истории
select throws_ok(
  $$ select plan_task_on_day('e0000000-0000-0000-0000-00000000000c', '2020-01-06', null) $$,
  null::char(5), 'date_before_history',
  'plan_task_on_day rejects a date before the task history'
);

select plan_task_on_day('e0000000-0000-0000-0000-00000000000c', '2020-01-08', null);

select is(
  (select count(*) from public.task_schedule where task_id = 'e0000000-0000-0000-0000-00000000000c'),
  3::bigint,
  'resuming a postponed task adds a day and keeps the history'
);

-- 26. Задачу с историей нельзя перетащить на другой день
select throws_ok(
  $$ select move_task_schedule('e0000000-0000-0000-0000-00000000000c', '2020-01-08', '2020-01-09', 0) $$,
  null::char(5), 'task_has_history',
  'move_task_schedule rejects moving a task with history to another day'
);

-- 27. Порядок внутри дня
select plan_task_on_day('e0000000-0000-0000-0000-00000000000d', '2020-01-08', 0);

select is(
  (select string_agg(t.title, ',' order by s.position)
     from public.task_schedule s join public.tasks t on t.id = s.task_id
     where s.project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and s.work_date = '2020-01-08'),
  'Task D,Task C',
  'plan_task_on_day inserts the task at the requested position'
);

select move_task_schedule('e0000000-0000-0000-0000-00000000000d', '2020-01-08', '2020-01-08', 1);

select is(
  (select string_agg(t.title || ':' || s.position, ',' order by s.position)
     from public.task_schedule s join public.tasks t on t.id = s.task_id
     where s.project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and s.work_date = '2020-01-08'),
  'Task C:0,Task D:1',
  'move_task_schedule reorders tasks within a day'
);

-- 28. Порядок в дополнительном списке
insert into public.board_items (id, project_id, list_id, title, position)
  select ('f0000000-0000-0000-0000-00000000000' || n)::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', l.id, 'Item ' || n, n - 1
  from (select id from public.board_lists
          where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' order by sort_order limit 1) l,
       generate_series(1, 3) n;

select move_board_item('f0000000-0000-0000-0000-000000000003', 0);

select is(
  (select string_agg(title, ',' order by position) from public.board_items
     where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Item 3,Item 1,Item 2',
  'move_board_item reorders items within a list'
);

-- ================= Пользователь B: проверки без доступа к проекту A =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 29. RPC отказывает пользователю без доступа к проекту материала
select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'receipt', 1, null) $$,
  null::char(5), null,
  'record_material_movement rejects users without access to the material''s project'
);

-- 30. Добавлять участников проекта может только его владелец
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member') $$,
  null::char(5), null,
  'only the project owner can add members'
);

-- 31. RPC перемещения не видят задачи и записи чужого проекта
select throws_ok(
  $$ select plan_task_on_day('e0000000-0000-0000-0000-00000000000a', '2020-01-10', null) $$,
  null::char(5), 'task_not_found',
  'plan_task_on_day rejects tasks of a project without access'
);

select throws_ok(
  $$ select move_task_schedule('e0000000-0000-0000-0000-00000000000d', '2020-01-08', '2020-01-09', 0) $$,
  null::char(5), 'task_not_found',
  'move_task_schedule rejects tasks of a project without access'
);

select throws_ok(
  $$ select return_task_to_backlog('e0000000-0000-0000-0000-00000000000d') $$,
  null::char(5), 'task_not_found',
  'return_task_to_backlog rejects tasks of a project without access'
);

select throws_ok(
  $$ select move_board_item('f0000000-0000-0000-0000-000000000001', 0) $$,
  null::char(5), 'item_not_found',
  'move_board_item rejects items of a project without access'
);

reset role;

select * from finish();

rollback;
