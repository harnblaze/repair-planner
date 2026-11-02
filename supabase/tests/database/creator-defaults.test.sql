-- Автор заявки и пункта списка (0031): default auth.uid(), триггер и бэкфилл.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(8);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member');

insert into public.board_lists (id, project_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Материалы к заказу');

-- ================= Обычный участник: и default, и триггер =================

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- created_by не передан вовсе — работает default auth.uid().
insert into public.tasks (id, project_id, title) values
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Заявка без автора в insert');

select is(
  (select created_by from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'default ставит автором того, кто вставил строку'
);

-- Клиент пытается записать чужого автора — триггер перезаписывает на auth.uid().
insert into public.tasks (id, project_id, title, created_by) values
  ('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Заявка с чужим автором', '11111111-1111-1111-1111-111111111111');

select is(
  (select created_by from public.tasks where id = '00000000-0000-0000-0000-000000000002'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'триггер перезаписывает присланного автора на auth.uid()'
);

insert into public.board_items (id, project_id, list_id, title) values
  ('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Пункт без автора в insert');

select is(
  (select created_by from public.board_items where id = '00000000-0000-0000-0000-000000000003'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'default ставит автора у пункта списка'
);

insert into public.board_items (id, project_id, list_id, title, created_by) values
  ('00000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Пункт с чужим автором', '11111111-1111-1111-1111-111111111111');

select is(
  (select created_by from public.board_items where id = '00000000-0000-0000-0000-000000000004'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'триггер перезаписывает автора и у пункта списка'
);

-- ================= Импорт без пользователя и бэкфилл =================

-- SQL-импорт идёт без JWT: auth.uid() пуст, и coalesce оставляет null как есть.
reset role;
select set_config('request.jwt.claim.sub', '', true) as _;

insert into public.tasks (id, project_id, title) values
  ('00000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Заявка из импорта');

select is(
  (select created_by from public.tasks where id = '00000000-0000-0000-0000-000000000005'),
  null::uuid,
  'без auth.uid() триггер не выдумывает автора'
);

insert into public.board_items (id, project_id, list_id, title) values
  ('00000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Пункт из импорта');

select is(
  (select created_by from public.board_items where id = '00000000-0000-0000-0000-000000000006'),
  null::uuid,
  'у пункта списка без auth.uid() автора тоже нет'
);

-- Бэкфилл из миграции: фикстуры появляются уже после неё, поэтому повторяем
-- ровно её утверждения — иначе проверять нечего.
update public.tasks t
  set created_by = p.owner_id
  from public.projects p
  where t.project_id = p.id and t.created_by is null;

update public.board_items i
  set created_by = p.owner_id
  from public.projects p
  where i.project_id = p.id and i.created_by is null;

select is(
  (select created_by from public.tasks where id = '00000000-0000-0000-0000-000000000005'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'бэкфилл ставит автором владельца проекта'
);

select is(
  (select created_by from public.board_items where id = '00000000-0000-0000-0000-000000000006'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'бэкфилл доходит и до пунктов списков'
);

select * from finish();

rollback;
