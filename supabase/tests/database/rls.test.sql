-- RLS и материальные операции: изоляция пользователей и атомарность.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(21);

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

-- ================= Пользователь B: проверки без доступа к проекту A =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 20. RPC отказывает пользователю без доступа к проекту материала
select throws_ok(
  $$ select record_material_movement('d0000000-0000-0000-0000-00000000000a', 'receipt', 1, null) $$,
  null::char(5), null,
  'record_material_movement rejects users without access to the material''s project'
);

-- 21. Добавлять участников проекта может только его владелец
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member') $$,
  null::char(5), null,
  'only the project owner can add members'
);

reset role;

select * from finish();

rollback;
