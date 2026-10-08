-- Очереди текущих заявок и ручной порядок (0018): RLS task_queues, составной FK,
-- триггер сброса backlog_position, RPC move_backlog_task. Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(45);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'queue-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'queue-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'queue-viewer-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.task_queues (id, project_id, name) values
  ('d1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Столярные дела'),
  ('d1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Чужая очередь');

insert into public.tasks (id, project_id, title, created_at) values
  ('f1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T1', '2026-01-01'),
  ('f1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T2', '2026-01-02'),
  ('f1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T3', '2026-01-03'),
  ('f1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TB', '2026-01-01');

insert into public.tasks (id, project_id, title, status, completed_at, created_at) values
  ('f1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T4', 'completed', now(), '2026-01-04');

insert into public.tasks (id, project_id, title, queue_id, created_at) values
  ('f1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q1',
   'd1000000-0000-0000-0000-00000000000a', '2026-01-06');

-- Видимый порядок панели очереди (как на доске). Создаётся в транзакции теста и
-- откатывается вместе с ней.
create function public._test_backlog(p_project uuid, p_queue uuid)
returns text[]
language sql
set search_path = ''
as $$
  select coalesce(
    array_agg(t.title order by t.backlog_position asc nulls first, t.created_at desc, t.id),
    '{}'
  )
  from public.tasks t
  where t.project_id = p_project
    and t.queue_id is not distinct from p_queue
    and t.planned_date is null
    and t.status not in ('completed', 'cancelled');
$$;
grant execute on function public._test_backlog(uuid, uuid) to authenticated;

-- ================= Структура =================

-- 1-4
select has_table('public', 'task_queues', 'task_queues exists');
select is((select relrowsecurity from pg_class where oid = 'public.task_queues'::regclass), true, 'RLS is enabled on task_queues');
select has_column('public', 'tasks', 'queue_id', 'tasks.queue_id exists');
select has_column('public', 'tasks', 'backlog_position', 'tasks.backlog_position exists');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 5. Создаёт очередь в своём проекте
select lives_ok(
  $$ insert into public.task_queues (id, project_id, name) values
     ('d1000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрика') $$,
  'owner creates a queue in own project'
);

-- 6. Видит только очереди своего проекта
select is((select count(*)::int from public.task_queues), 2, 'owner sees only own project queues');

-- 7. Не может создать очередь в чужом проекте
select throws_ok(
  $$ insert into public.task_queues (project_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Взлом') $$,
  '42501', null,
  'owner cannot create a queue in another project'
);

-- 8. project_id очереди неизменяем
select throws_ok(
  $$ update public.task_queues set project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     where id = 'd1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'queue project_id cannot be changed'
);

-- 9. Переименование
select lives_ok(
  $$ update public.task_queues set name = 'Электрика и свет' where id = 'd1000000-0000-0000-0000-0000000000e1' $$,
  'owner renames a queue'
);

-- 10. Очередь чужого проекта отвергает составной FK
select throws_ok(
  $$ update public.tasks set queue_id = 'd1000000-0000-0000-0000-00000000000b'
     where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'task cannot reference a queue of another project'
);

-- 11. Нерасставленные заявки — новые сверху
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T2', 'T1'],
  'unranked tasks are ordered newest first'
);

-- 12-14. Перестановка материализует видимый порядок
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', null, 0) $$,
  'owner moves T1 to the top'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T1', 'T3', 'T2'],
  'T1 is first, the rest keep their visible order'
);
select is(
  (select count(*)::int from public.tasks
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and queue_id is null
      and planned_date is null and status not in ('completed', 'cancelled') and backlog_position is null),
  0,
  'every task of the main queue got a position'
);

-- 15-18. Позиция зажимается в границы списка
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000003', null, 99) $$,
  'position above the list is accepted'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T1', 'T2', 'T3'],
  'position above the list puts the task last'
);
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000003', null, -5) $$,
  'negative position is accepted'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T1', 'T2'],
  'negative position puts the task first'
);

-- 19-20. Закрытые заявки и чужой проект не перенумеровываются
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000004'),
  null::int,
  'completed task keeps a null position'
);
select is(
  (select count(*)::int from public.tasks where id = 'f1000000-0000-0000-0000-00000000000b'),
  0,
  'task of another project is invisible to the owner'
);

-- 21-25. Перенос в другую очередь и перестановка внутри неё
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 0) $$,
  'owner moves T1 into the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-00000000000a'),
  array['T1', 'Q1'],
  'T1 is first in the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T2'],
  'the main queue keeps its order without T1'
);
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 5) $$,
  'owner reorders inside the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-00000000000a'),
  array['Q1', 'T1'],
  'T1 is last in the carpentry queue'
);

-- 26-27. Отказы
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000b', 0) $$,
  'P0001', 'queue_not_found',
  'queue of another project is rejected'
);
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000004', null, 0) $$,
  'P0001', 'task_closed',
  'closed task cannot be reordered'
);

-- ================= Владелец B =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 28-29
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'task_not_found',
  'task of another project is not found'
);
select is((select count(*)::int from public.task_queues), 1, 'owner B sees only own queue');

-- ================= Viewer C в проекте A =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 30-32
select is((select count(*)::int from public.task_queues), 2, 'viewer sees queues of the project');
select throws_ok(
  $$ insert into public.task_queues (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Взлом') $$,
  '42501', null,
  'viewer cannot create a queue'
);
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'access_denied',
  'viewer cannot reorder'
);

-- Под RLS эти операции молча затрагивают ноль строк — результат проверяется ниже.
update public.task_queues set name = 'Взлом' where id = 'd1000000-0000-0000-0000-00000000000a';
delete from public.task_queues where id = 'd1000000-0000-0000-0000-0000000000e1';

reset role;

-- 33-34
select is(
  (select name from public.task_queues where id = 'd1000000-0000-0000-0000-00000000000a'),
  'Столярные дела',
  'viewer cannot rename a queue'
);
select is(
  (select count(*)::int from public.task_queues where id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'viewer cannot delete a queue'
);

-- ================= Триггер сброса позиции (как postgres) =================

-- 35. Планирование на день обнуляет позицию
insert into public.task_schedule (project_id, task_id, work_date, position) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1000000-0000-0000-0000-000000000002', '2026-10-12', 0);
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000002'),
  null::int,
  'planning a task resets its position'
);

-- 36. Запланированную заявку нельзя переставить в панели
update public.tasks set backlog_position = 7 where id = 'f1000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'task_already_planned',
  'planned task cannot be reordered'
);
reset role;

-- 37. Возврат с доски (последний день отложен) — наверх своей очереди
update public.task_schedule set postponed = true where task_id = 'f1000000-0000-0000-0000-000000000002';
select is(
  (public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null))[1],
  'T2',
  'a task returned to the backlog is first in its queue'
);

-- 38. Новая заявка — первой в своей очереди
insert into public.tasks (id, project_id, title) values
  ('f1000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T7');
select is(
  (public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null))[1],
  'T7',
  'a new task is first in its queue'
);

-- 39. Смена статуса между открытыми сохраняет позицию
update public.tasks set status = 'in_progress' where id = 'f1000000-0000-0000-0000-000000000003';
select isnt(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000003'),
  null::int,
  'changing status between open statuses keeps the position'
);

-- 40. Переоткрытая заявка — наверх, даже выше более новой T7
update public.tasks set status = 'completed', completed_at = now() where id = 'f1000000-0000-0000-0000-000000000003';
update public.tasks set status = 'new', completed_at = null where id = 'f1000000-0000-0000-0000-000000000003';
select is(
  (public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null))[1],
  'T3',
  'a reopened older task is first in its queue'
);

-- 41. Смена очереди — наверх новой очереди
update public.tasks set queue_id = 'd1000000-0000-0000-0000-0000000000e1' where id = 'f1000000-0000-0000-0000-000000000006';
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000e1'),
  array['Q1'],
  'a task that changed its queue is in the new queue'
);

-- 42-43. Удаление очереди переводит её заявки в основную
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;
select lives_ok(
  $$ delete from public.task_queues where id = 'd1000000-0000-0000-0000-00000000000a' $$,
  'owner deletes a queue'
);
reset role;
select ok(
  (select queue_id is null and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     from public.tasks where id = 'f1000000-0000-0000-0000-000000000001')
  and (public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null))[1] = 'T1',
  'tasks of a deleted queue move to the top of the main queue'
);

-- 44-45. Права на функцию
select ok(
  not has_function_privilege('anon', 'public.move_backlog_task(uuid, uuid, int)', 'execute'),
  'anon cannot execute move_backlog_task'
);
select ok(
  has_function_privilege('authenticated', 'public.move_backlog_task(uuid, uuid, int)', 'execute'),
  'authenticated can execute move_backlog_task'
);

select * from finish();

rollback;
