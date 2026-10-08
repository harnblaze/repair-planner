-- Архив и удаление проектов (0027): политика DELETE, триггер расхода при
-- каскаде, public.project_attachment_paths.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец PA (активный) и PZ (архивный), B — владелец PB (архивный),
-- D — member в PZ.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'arch-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'arch-owner-b@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'arch-member-d@example.com');

insert into public.projects (id, owner_id, name, archived_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Active A', null),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Archived Z', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Archived B', now());

insert into public.project_members (project_id, user_id, role) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.materials (id, project_id, name, unit) values
  ('d3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрод A', 'кг'),
  ('d3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Электрод Z', 'кг');

insert into public.tasks (id, project_id, title) values
  ('e3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Task Z');

-- Расход: триггер пишет движения consumption в оба проекта.
insert into public.task_materials (id, project_id, task_id, material_id, quantity) values
  ('f3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'e3000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 3),
  ('f3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'e3000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', 2);

insert into storage.buckets (id, name, public) values ('archive-test-other', 'archive-test-other', false);

insert into storage.objects (bucket_id, name) values
  ('task-attachments', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000002.jpg'),
  ('task-attachments', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000001.jpg'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e3000000-0000-0000-0000-00000000000a/f4000000-0000-0000-0000-000000000003.jpg'),
  ('archive-test-other', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000004.jpg');

-- 1-2
select has_function('public', 'project_attachment_paths', array['uuid', 'integer'], 'project_attachment_paths exists');
select ok(
  not has_function_privilege('anon', 'public.project_attachment_paths(uuid, integer)', 'execute'),
  'anon cannot execute project_attachment_paths'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Активный проект не удаляется даже владельцем
with del as (
  delete from public.projects where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'owner cannot delete an active project');

-- 4. Для активного проекта пути не выдаются
select is(
  (select count(*) from public.project_attachment_paths('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0::bigint,
  'no paths for an active project'
);

-- 5. Для своего архивного — все его файлы bucket task-attachments, по имени
select is(
  array(select public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc')),
  array[
    'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000001.jpg',
    'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000002.jpg'
  ],
  'all files of own archived project in task-attachments, by name'
);

-- 6. p_limit ограничивает выборку
select is(
  (select count(*) from public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc', 1)),
  1::bigint,
  'p_limit limits the result'
);

-- 7. Чужой архивный проект не удаляется
with del as (
  delete from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id
)
select is((select count(*) from del), 0::bigint, 'owner cannot delete a foreign archived project');

reset role;

-- ================= Member D =================

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 8. Участнику пути не выдаются
select is(
  (select count(*) from public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc')),
  0::bigint,
  'member gets no paths'
);

-- 9. Участник не удаляет архивный проект
with del as (
  delete from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' returning id
)
select is((select count(*) from del), 0::bigint, 'member cannot delete an archived project');

reset role;

-- ================= Владелец A: удаление =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 10. Удаление расхода в живом проекте по-прежнему пишет движение adjustment
delete from public.task_materials where id = 'f3000000-0000-0000-0000-00000000000a';
select is(
  (select count(*) from public.material_movements
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and kind = 'adjustment' and quantity = 3),
  1::bigint,
  'deleting consumption in a live project still records an adjustment'
);

-- 11. …и возвращает остаток материала (было −3 после расхода)
select is(
  (select current_balance from public.materials where id = 'd3000000-0000-0000-0000-00000000000a'),
  0::numeric,
  'deleting consumption in a live project restores the balance'
);

-- 12. Архивный проект с расходом удаляется (раньше падал на FK журнала)
with del as (
  delete from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' returning id
)
select is((select count(*) from del), 1::bigint, 'owner deletes an archived project with consumption');

reset role;

-- 13. Каскад убрал данные проекта
select is(
  (select count(*) from public.tasks where project_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
  + (select count(*) from public.material_movements where project_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0::bigint,
  'cascade removed tasks and movements of the deleted project'
);

select * from finish();

rollback;
