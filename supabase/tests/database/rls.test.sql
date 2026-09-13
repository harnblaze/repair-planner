-- RLS и материальные операции: изоляция пользователей и атомарность.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(127);

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
-- Фиксированный понедельник: с 0013 выходной день в расписание не записывается.
insert into public.task_schedule (project_id, task_id, work_date) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000000a', '2020-01-13');

select is(
  (select planned_date from public.tasks where id = 'e0000000-0000-0000-0000-00000000000a'),
  '2020-01-13'::date,
  'scheduling a work day recalculates the cached planned_date'
);

-- 17. Системный список нельзя удалить
with del as (
  delete from public.board_lists
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and is_system returning id
)
select is((select count(*) from del), 0::bigint, 'system board lists cannot be deleted');

-- ================= Пользовательские списки (0014) =================

-- 17a. Системный список нельзя создать и нельзя снять с него признак
select throws_ok(
  $$ insert into public.board_lists (project_id, name, is_system)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fake system', true) $$,
  '42501', null,
  'a client cannot create a system board list'
);

select throws_ok(
  $$ update public.board_lists set is_system = false
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and is_system $$,
  null::char(5), 'board_list_system_readonly',
  'is_system of a board list is immutable'
);

-- 17b. Пустое название отклоняется
select throws_ok(
  $$ insert into public.board_lists (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ') $$,
  '23514', null,
  'a board list name cannot be blank'
);

-- 17c. Пользовательский список: создание, переименование, порядок
insert into public.board_lists (id, project_id, name, sort_order) values
  ('9a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Инструмент', 3),
  ('9a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Временный', 4);

with upd as (
  update public.board_lists set name = 'Инструмент в ремонт'
    where id = '9a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*) from upd), 1::bigint, 'owner can rename a custom board list');

select move_board_list('9a000000-0000-0000-0000-000000000001', 0);

select is(
  (select string_agg(name || ':' || sort_order, ',' order by sort_order)
     from public.board_lists where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Инструмент в ремонт:0,Материалы к заказу:1,Напоминания:2,Мероприятия:3,Временный:4',
  'move_board_list reorders the lists of a project'
);

-- Возвращаем системные списки вперёд: тест 28 берёт первый список проекта.
select move_board_list('9a000000-0000-0000-0000-000000000001', 3);

select throws_ok(
  $$ update public.board_lists set project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       where id = '9a000000-0000-0000-0000-000000000001' $$,
  null::char(5), 'board_list_project_readonly',
  'a board list cannot be moved to another project'
);

-- 17d. Удаление пользовательского списка удаляет его записи
insert into public.board_items (project_id, list_id, title) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '9a000000-0000-0000-0000-000000000002', 'Временная запись');

with del as (
  delete from public.board_lists where id = '9a000000-0000-0000-0000-000000000002' returning id
)
select is((select count(*) from del), 1::bigint, 'owner can delete a custom board list');

select is(
  (select count(*) from public.board_items where list_id = '9a000000-0000-0000-0000-000000000002'),
  0::bigint,
  'deleting a custom board list removes its items'
);

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

-- ================= Календарь проекта (0013) =================
-- 2020-01-18 — суббота, 2020-01-19 — воскресенье, 2020-01-20 — понедельник.

insert into public.tasks (id, project_id, title) values
  ('e0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Calendar Task 1'),
  ('e0000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Calendar Task 2');

-- Задача запланирована на среду до того, как среду объявили нерабочей.
select plan_task_on_day('e0000000-0000-0000-0000-0000000000c2', '2020-01-22', null);

insert into public.project_calendar_days (project_id, day, kind, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-01-18', 'working_day', 'Перенос выходного'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-01-20', 'holiday', 'Праздник'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-01-22', 'holiday', 'Объявлен позже');

-- 28a. Исключение должно менять правило Пн–Пт
select throws_ok(
  $$ insert into public.project_calendar_days (project_id, day, kind)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-01-19', 'holiday') $$,
  '23514', null,
  'a holiday exception cannot fall on a weekend'
);

select throws_ok(
  $$ insert into public.project_calendar_days (project_id, day, kind)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-01-21', 'working_day') $$,
  '23514', null,
  'a working day exception must be a Saturday'
);

-- 28b. Нерабочий день отклоняется и RPC, и прямой записью расписания
select throws_ok(
  $$ select plan_task_on_day('e0000000-0000-0000-0000-0000000000c1', '2020-01-20', null) $$,
  null::char(5), 'not_working_day',
  'plan_task_on_day rejects a project holiday'
);

select throws_ok(
  $$ insert into public.task_schedule (project_id, task_id, work_date)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-0000000000c1', '2020-01-20') $$,
  null::char(5), 'not_working_day',
  'a direct schedule insert on a project holiday is rejected'
);

select throws_ok(
  $$ insert into public.task_schedule (project_id, task_id, work_date)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-0000000000c1', '2020-01-19') $$,
  null::char(5), 'not_working_day',
  'a direct schedule insert on a Sunday is rejected'
);

-- 28c. Рабочая суббота
select plan_task_on_day('e0000000-0000-0000-0000-0000000000c1', '2020-01-18', null);

select is(
  (select planned_date from public.tasks where id = 'e0000000-0000-0000-0000-0000000000c1'),
  '2020-01-18'::date,
  'plan_task_on_day accepts a working Saturday'
);

-- 28d. Перенос пропускает воскресенье и праздник, прошлый день остаётся историей
select is(
  carry_over_task('e0000000-0000-0000-0000-0000000000c1'),
  '2020-01-21'::date,
  'carry_over_task skips Sunday and a project holiday'
);

select is(
  (select string_agg(work_date::text || ':' || carried_over::text, ',' order by work_date)
     from public.task_schedule where task_id = 'e0000000-0000-0000-0000-0000000000c1'),
  '2020-01-18:false,2020-01-21:true',
  'carry_over_task adds the next working day and keeps the previous one'
);

-- 28e. Задачи дня, объявленного нерабочим позже, остаются и упорядочиваются
select lives_ok(
  $$ select move_task_schedule('e0000000-0000-0000-0000-0000000000c2', '2020-01-22', '2020-01-22', 0) $$,
  'tasks on a day declared a holiday later can still be reordered'
);

select throws_ok(
  $$ select move_task_schedule('e0000000-0000-0000-0000-0000000000c2', '2020-01-22', '2020-01-20', 0) $$,
  null::char(5), 'not_working_day',
  'move_task_schedule rejects moving a task to a project holiday'
);

-- 28f. Закрытую задачу перенести нельзя
update public.tasks set status = 'completed', completed_at = now() where id = 'e0000000-0000-0000-0000-0000000000c1';

select throws_ok(
  $$ select carry_over_task('e0000000-0000-0000-0000-0000000000c1') $$,
  null::char(5), 'task_closed',
  'carry_over_task rejects a closed task'
);

-- ================= Отчёт по расходу материалов (0009) =================

insert into public.materials (id, project_id, name, unit) values
  ('d0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Report Material', 'шт');

insert into public.tasks (id, project_id, title, category_id) values
  ('e0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Report Task 1', 'c0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Report Task 2', null);

insert into public.task_materials (project_id, task_id, material_id, quantity) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2', 5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a2', 2);

update public.task_materials set quantity = 7
  where task_id = 'e0000000-0000-0000-0000-0000000000a1' and material_id = 'd0000000-0000-0000-0000-0000000000a2';

-- Даты движений задаются в обход RLS: клиент журнал не меняет.
-- Проект в Europe/Moscow (UTC+3): 2026-03-31 21:30 UTC — это уже 1 апреля по Москве.
reset role;
update public.material_movements set occurred_at = '2026-03-31 21:30:00+00'
  where task_id = 'e0000000-0000-0000-0000-0000000000a1' and kind = 'consumption';
update public.material_movements set occurred_at = '2026-04-15 12:00:00+00'
  where task_id = 'e0000000-0000-0000-0000-0000000000a1' and kind = 'adjustment';
update public.material_movements set occurred_at = '2026-03-31 20:30:00+00'
  where task_id = 'e0000000-0000-0000-0000-0000000000a2';
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 29. Месяц — в timezone проекта; правка расхода суммируется с исходным списанием
select is(
  (select string_agg(coalesce(category_name, '—') || ':' || material_name || ':' || quantity::text, ',')
     from public.material_consumption_by_category('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-04-01')
     where material_name = 'Report Material'),
  'Category A:Report Material:7.000',
  'monthly report uses the project timezone and nets consumption edits by movement date'
);

-- 30. Заявка без категории попадает в отдельную группу своего месяца
select is(
  (select string_agg(coalesce(category_name, '—') || ':' || quantity::text, ',')
     from public.material_consumption_by_category('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-15')
     where material_name = 'Report Material'),
  '—:2.000',
  'monthly report groups tasks without a category separately'
);

-- ================= Приход и корректировка по пересчёту (0010) =================

insert into public.materials (id, project_id, name, unit) values
  ('d0000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Count Material', 'кг');

select record_material_movement('d0000000-0000-0000-0000-0000000000a3', 'receipt', 10, null);

-- 35. Приход не может быть отрицательным
select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-0000000000a3', 'receipt', -1, null) $$,
  null::char(5), 'invalid_quantity',
  'record_material_movement rejects a negative receipt'
);

-- 36-37. Фактический остаток: база считает разницу и пишет корректировку
select set_material_balance('d0000000-0000-0000-0000-0000000000a3', 7.5, '  пересчёт  ');

select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-0000000000a3'),
  7.5::numeric,
  'set_material_balance sets the exact counted balance'
);

select is(
  (select kind::text || ':' || quantity::text || ':' || coalesce(note, '') || ':' || (task_id is null)::text
     from public.material_movements
     where material_id = 'd0000000-0000-0000-0000-0000000000a3' and kind = 'adjustment'),
  'adjustment:-2.500:пересчёт:true',
  'set_material_balance records an adjustment with the computed delta and trimmed note'
);

-- 38. Остаток уже равен введённому значению
select throws_ok(
  $$ select set_material_balance('d0000000-0000-0000-0000-0000000000a3', 7.5, null) $$,
  null::char(5), 'balance_unchanged',
  'set_material_balance rejects a count equal to the current balance'
);

-- 39. Фактический остаток не может быть отрицательным
select throws_ok(
  $$ select set_material_balance('d0000000-0000-0000-0000-0000000000a3', -1, null) $$,
  null::char(5), 'invalid_quantity',
  'set_material_balance rejects a negative count'
);

-- ================= Пользователь B: проверки без доступа к проекту A =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 31. RPC отказывает пользователю без доступа к проекту материала
select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'receipt', 1, null) $$,
  null::char(5), 'material_not_found',
  'record_material_movement rejects users without access to the material''s project'
);

-- 40. Корректировка чужого материала неотличима от несуществующего
select throws_ok(
  $$ select set_material_balance('d0000000-0000-0000-0000-0000000000a3', 100, null) $$,
  null::char(5), 'material_not_found',
  'set_material_balance rejects users without access to the material''s project'
);

-- 32. Добавить себя в чужой проект напрямую нельзя
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member') $$,
  null::char(5), null,
  'an outsider cannot add themselves to a project'
);

-- 33. RPC перемещения не видят задачи и записи чужого проекта
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

select throws_ok(
  $$ select move_board_list('9a000000-0000-0000-0000-000000000001', 0) $$,
  null::char(5), 'list_not_found',
  'move_board_list rejects lists of a project without access'
);

-- 33b. Списки чужого проекта не видны, не создаются и не удаляются
select is(
  (select count(*) from public.board_lists where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'an outsider cannot select board lists of another project'
);

select throws_ok(
  $$ insert into public.board_lists (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Чужой список') $$,
  '42501', null,
  'an outsider cannot create a board list in another project'
);

with del as (
  delete from public.board_lists where id = '9a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*) from del), 0::bigint, 'an outsider cannot delete a board list of another project');

-- 33a. Календарь чужого проекта не виден и не изменяется
select is(
  (select count(*) from public.project_calendar_days where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'an outsider cannot select the calendar of another project'
);

select throws_ok(
  $$ insert into public.project_calendar_days (project_id, day, kind)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-02-03', 'holiday') $$,
  '42501', null,
  'an outsider cannot add calendar days to another project'
);

with del as (
  delete from public.project_calendar_days
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'an outsider cannot delete calendar days of another project');

select throws_ok(
  $$ select carry_over_task('e0000000-0000-0000-0000-0000000000c2') $$,
  null::char(5), 'task_not_found',
  'carry_over_task rejects tasks of a project without access'
);

-- 34. Отчёт не показывает расход чужого проекта
select is(
  (select count(*) from public.material_consumption_by_category('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-04-01')),
  0::bigint,
  'monthly report returns nothing for a project without access'
);

reset role;

-- 41. Отклонённая корректировка пользователя B не изменила остаток
select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-0000000000a3'),
  7.5::numeric,
  'a rejected foreign balance count leaves the balance unchanged'
);

-- ================= Приглашения и роли (0011, 0012) =================
-- C принимает приглашение viewer, D — member. Токены сохраняются в настройках
-- транзакции, чтобы передать их между сменами пользователя.

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'member-d@example.com');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

select set_config('test.viewer_token', token, true) as _
  from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer');
select set_config('test.member_token', token, true) as _
  from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member');
select set_config('test.expired_token', token, true) as _
  from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer');
select set_config('test.pending_token', token, true) as _
  from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member');

-- 42. Роль owner через приглашение не выдаётся
select throws_ok(
  $$ select * from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner') $$,
  null::char(5), 'invalid_role',
  'an invitation cannot grant the owner role'
);

-- 43. Токен не хранится в открытом виде
select is(
  (select count(*) from public.project_invitations
     where token_hash = convert_to(current_setting('test.viewer_token'), 'UTF8')),
  0::bigint,
  'invitation token is stored only as a hash'
);

reset role;
update public.project_invitations set expires_at = now() - interval '1 minute'
  where token_hash = extensions.digest(current_setting('test.expired_token'), 'sha256');

-- ----- Посторонний B -----
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 44. Приглашение в чужой проект создать нельзя
select throws_ok(
  $$ select * from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer') $$,
  null::char(5), 'access_denied',
  'an outsider cannot create invitations'
);

-- 45. Приглашения и участники чужого проекта не видны
select is(
  (select count(*) from public.project_invitations where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'an outsider cannot select invitations of another project'
);

select is(
  (select count(*) from project_member_list('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0::bigint,
  'an outsider gets an empty member list'
);

-- ----- Viewer C -----
reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 46. Экран приглашения видит проект и статус
select is(
  (select project_name || ':' || role::text || ':' || status
     from get_project_invitation(current_setting('test.viewer_token'))),
  'Project A:viewer:valid',
  'get_project_invitation shows the project, role and status by token'
);

select is(
  (select count(*) from get_project_invitation('not-a-real-token')),
  0::bigint,
  'get_project_invitation returns nothing for an unknown token'
);

-- 47. Недействительные ссылки (до принятия: участнику любая ссылка проекта
-- просто возвращает проект)
select throws_ok(
  $$ select accept_project_invitation(current_setting('test.expired_token')) $$,
  null::char(5), 'invitation_expired',
  'an expired invitation cannot be accepted'
);

select throws_ok(
  $$ select accept_project_invitation('not-a-real-token') $$,
  null::char(5), 'invitation_not_found',
  'an unknown invitation token is rejected'
);

-- 48. Принятие даёт роль viewer
select is(
  accept_project_invitation(current_setting('test.viewer_token')),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'accept_project_invitation returns the project id'
);

select is(
  project_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text,
  'viewer',
  'accepted invitation grants its role'
);

-- 49. Viewer читает данные проекта
select ok(
  (select count(*) from public.tasks where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') > 0,
  'viewer can select project tasks'
);

-- 50. Viewer не может менять данные проекта
select throws_ok(
  $$ insert into public.categories (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Viewer category') $$,
  '42501', null,
  'viewer cannot insert categories'
);

select throws_ok(
  $$ insert into public.task_materials (project_id, task_id, material_id, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a3', 1) $$,
  '42501', null,
  'viewer cannot record material consumption'
);

with upd as (
  update public.tasks set title = 'hacked' where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from upd), 0::bigint, 'viewer cannot update tasks');

with del as (
  delete from public.board_items where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete board items');

select throws_ok(
  $$ insert into public.board_lists (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Список viewer') $$,
  '42501', null,
  'viewer cannot create board lists'
);

with del as (
  delete from public.board_lists where id = '9a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete board lists');

select throws_ok(
  $$ select move_board_list('9a000000-0000-0000-0000-000000000001', 0) $$,
  null::char(5), 'access_denied',
  'viewer cannot reorder board lists'
);

select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-0000000000a3', 'receipt', 1, null) $$,
  null::char(5), 'access_denied',
  'viewer cannot record a receipt'
);

select throws_ok(
  $$ select set_material_balance('d0000000-0000-0000-0000-0000000000a3', 100, null) $$,
  null::char(5), 'access_denied',
  'viewer cannot count a material balance'
);

select throws_ok(
  $$ select plan_task_on_day('e0000000-0000-0000-0000-0000000000a2', '2020-01-10', null) $$,
  null::char(5), 'task_not_found',
  'viewer cannot plan tasks through the board RPC'
);

-- 50a. Viewer видит календарь, но не меняет его и не переносит задачи
select ok(
  (select count(*) from public.project_calendar_days where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') > 0,
  'viewer can select the project calendar'
);

select throws_ok(
  $$ insert into public.project_calendar_days (project_id, day, kind)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-02-03', 'holiday') $$,
  '42501', null,
  'viewer cannot add calendar days'
);

with del as (
  delete from public.project_calendar_days
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete calendar days');

select throws_ok(
  $$ select carry_over_task('e0000000-0000-0000-0000-0000000000c2') $$,
  null::char(5), 'task_not_found',
  'viewer cannot carry over tasks'
);

-- 51. Viewer не управляет участниками и не видит приглашения
select throws_ok(
  $$ select * from create_project_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member') $$,
  null::char(5), 'access_denied',
  'viewer cannot create invitations'
);

select is(
  (select count(*) from public.project_invitations where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'viewer cannot select invitations'
);

with upd as (
  update public.project_members set role = 'member'
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '33333333-3333-3333-3333-333333333333'
    returning user_id
)
select is((select count(*) from upd), 0::bigint, 'viewer cannot raise their own role');

-- 52. Email других участников скрыт от не-владельца
select is(
  (select string_agg(role::text || ':' || coalesce(email, '-'), ',' order by role)
     from project_member_list('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'owner:-,viewer:viewer-c@example.com',
  'member list hides other members'' emails from non-owners'
);

-- ----- Member D -----
reset role;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 53. Использованную ссылку повторно принять нельзя
select throws_ok(
  $$ select accept_project_invitation(current_setting('test.viewer_token')) $$,
  null::char(5), 'invitation_used',
  'a used invitation cannot be accepted again'
);

select accept_project_invitation(current_setting('test.member_token'));

-- 54. Member редактирует данные проекта
select lives_ok(
  $$ insert into public.tasks (project_id, title) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Member task') $$,
  'member can create tasks'
);

select lives_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'receipt', 1, null) $$,
  'member can record a receipt'
);

select lives_ok(
  $$ insert into public.board_lists (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Список редактора') $$,
  'member can create board lists'
);

select lives_ok(
  $$ select move_board_list('9a000000-0000-0000-0000-000000000001', 0) $$,
  'member can reorder board lists'
);

-- 54a. Member ведёт календарь проекта
select lives_ok(
  $$ insert into public.project_calendar_days (project_id, day, kind)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2020-02-03', 'holiday') $$,
  'member can add calendar days'
);

with del as (
  delete from public.project_calendar_days
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and day = '2020-02-03' returning id
)
select is((select count(*) from del), 1::bigint, 'member can delete calendar days');

-- 55. Member не меняет настройки проекта и роли участников
with upd as (
  update public.projects set name = 'renamed by member' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from upd), 0::bigint, 'member cannot update project settings');

with upd as (
  update public.project_members set role = 'member'
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '33333333-3333-3333-3333-333333333333'
    returning user_id
)
select is((select count(*) from upd), 0::bigint, 'member cannot change roles of other members');

-- ----- Owner A -----
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 56. Владелец меняет роль участника
with upd as (
  update public.project_members set role = 'member'
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '33333333-3333-3333-3333-333333333333'
    returning user_id
)
select is((select count(*) from upd), 1::bigint, 'owner can change a member role');

select throws_ok(
  $$ update public.project_members set role = 'owner'
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'owner cannot grant the owner role'
);

select throws_ok(
  $$ update public.project_members set user_id = '22222222-2222-2222-2222-222222222222'
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'owner cannot replace the user of a membership'
);

select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'viewer') $$,
  '42501', null,
  'owner cannot add members directly, only through invitations'
);

-- 57. Строку владельца удалить нельзя
with del as (
  delete from public.project_members
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and role = 'owner' returning user_id
)
select is((select count(*) from del), 0::bigint, 'the owner membership cannot be deleted');

-- 58. Отозвать можно только непринятое приглашение
with del as (
  delete from public.project_invitations
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and accepted_at is not null returning id
)
select is((select count(*) from del), 0::bigint, 'accepted invitations cannot be revoked');

with del as (
  delete from public.project_invitations
    where token_hash = extensions.digest(current_setting('test.pending_token'), 'sha256') returning id
)
select is((select count(*) from del), 1::bigint, 'owner can revoke a pending invitation');

select is(
  (select status from get_project_invitation(current_setting('test.viewer_token'))),
  'already_member',
  'get_project_invitation reports an existing membership'
);

-- 59. Владелец видит email участников
select is(
  (select count(*) from project_member_list('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') where email is not null),
  3::bigint,
  'owner sees emails of all members'
);

-- ----- Member D выходит из проекта -----
reset role;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 60. Участник может покинуть проект и теряет доступ
with del as (
  delete from public.project_members
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '44444444-4444-4444-4444-444444444444'
    returning user_id
)
select is((select count(*) from del), 1::bigint, 'a member can leave the project');

select is(
  (select count(*) from public.projects where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'a member who left no longer sees the project'
);

reset role;

-- 61. Попытки viewer не изменили остаток
select is(
  (select current_balance from public.materials where id = 'd0000000-0000-0000-0000-0000000000a3'),
  7.5::numeric,
  'rejected viewer operations leave the balance unchanged'
);

select * from finish();

rollback;
