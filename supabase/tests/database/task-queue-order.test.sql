-- Ручной порядок очередей (0022): task_queues.sort_order и RPC move_task_queue.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(12);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'order-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'order-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'order-viewer-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.task_queues (id, project_id, name, sort_order) values
  ('d2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q1', 0),
  ('d2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q2', 1),
  ('d2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q3', 2),
  ('d2000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'QB', 0);

-- Порядок очередей проекта A так, как его показывает приложение.
create function public._test_queue_order()
returns text
language sql
set search_path = ''
as $$
  select string_agg(q.name, ',' order by q.sort_order, q.created_at, q.id)
  from public.task_queues q
  where q.project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
$$;
grant execute on function public._test_queue_order() to authenticated;

-- ================= Структура =================

-- 1-4
select has_column('public', 'task_queues', 'sort_order', 'task_queues.sort_order exists');
select has_function('public', 'move_task_queue', array['uuid', 'integer'], 'move_task_queue(uuid, int) exists');
select ok(
  not has_function_privilege('anon', 'public.move_task_queue(uuid, integer)', 'execute'),
  'anon cannot execute move_task_queue'
);
select ok(
  has_column_privilege('authenticated', 'public.task_queues', 'sort_order', 'update'),
  'authenticated may update task_queues.sort_order (RLS limits it to editors)'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 5. Q3 — наверх
select public.move_task_queue('d2000000-0000-0000-0000-000000000003', 0);
select is(public._test_queue_order(), 'Q3,Q1,Q2', 'move_task_queue puts a queue on top');

-- 6. null — в конец
select public.move_task_queue('d2000000-0000-0000-0000-000000000003', null);
select is(public._test_queue_order(), 'Q1,Q2,Q3', 'null position moves a queue to the end');

-- 7. Позиция за пределами — прижимается к границам
select public.move_task_queue('d2000000-0000-0000-0000-000000000001', 99);
select is(public._test_queue_order(), 'Q2,Q3,Q1', 'too large position means the end');

-- 8
select public.move_task_queue('d2000000-0000-0000-0000-000000000001', -5);
select is(public._test_queue_order(), 'Q1,Q2,Q3', 'negative position means the top');

-- 9. Номера — плотные 0..n-1
select is(
  (select array_agg(sort_order order by sort_order) from public.task_queues
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  array[0, 1, 2],
  'sort_order is renumbered 0..n-1'
);

-- 10. Очередь чужого проекта неотличима от несуществующей
select throws_ok(
  $$ select public.move_task_queue('d2000000-0000-0000-0000-00000000000b', 0) $$,
  null::char(5), 'queue_not_found',
  'move_task_queue rejects queues of a project without access'
);

reset role;

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 11-12. Viewer видит очереди, но порядок не меняет
select throws_ok(
  $$ select public.move_task_queue('d2000000-0000-0000-0000-000000000003', 0) $$,
  null::char(5), 'access_denied',
  'viewer cannot reorder queues'
);
select is(public._test_queue_order(), 'Q1,Q2,Q3', 'viewer attempt keeps the order');

reset role;

select * from finish();

rollback;
