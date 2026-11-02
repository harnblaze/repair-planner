-- Чат проекта (0033): RLS сообщений и отметок о прочитанном, авторство,
-- ограничение длины, чистка и публикация Realtime.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(14);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'chat-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'chat-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'chat-member-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Chat Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Chat Project B');

-- Владельца в project_members не вставляем: его добавляет триггер проекта.
insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member');

-- ================= Владелец A пишет в проект A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

insert into public.project_messages (id, project_id, body) values
  ('e0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сообщение проекта A'),
  ('e0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Своё сообщение, которое удалим');

-- ================= Владелец B пишет в проект B =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

insert into public.project_messages (id, project_id, body) values
  ('e0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Сообщение проекта B');

-- ================= Участник C видит только свой проект =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

select is(
  (select count(*)::int from public.project_messages
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'участник видит сообщения своего проекта'
);

select is(
  (select count(*)::int from public.project_messages
    where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'чужой проект не виден: RLS отсекает сообщения другого проекта'
);

-- Чужое сообщение удалить нельзя: строка остаётся на месте.
delete from public.project_messages where id = 'e0000000-0000-4000-8000-0000000000a1';

select is(
  (select count(*)::int from public.project_messages
    where id = 'e0000000-0000-4000-8000-0000000000a1'),
  1,
  'чужое сообщение не удаляется: DELETE-политика пропускает только своё'
);

-- ================= Авторство не подделать =================

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

insert into public.project_messages (id, project_id, author_id, body) values
  ('e0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', 'Попытка записать чужого автора');

select is(
  (select author_id from public.project_messages
    where id = 'e0000000-0000-4000-8000-0000000000c1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'author_id перезаписывается на вошедшего, чужое авторство не сохраняется'
);

-- ================= Ограничения тела сообщения =================

select throws_ok(
  $$ insert into public.project_messages (id, project_id, body)
     values ('e0000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '') $$,
  '23514', null,
  'пустое тело отклоняется CHECK'
);

select throws_ok(
  $$ insert into public.project_messages (id, project_id, body)
     values ('e0000000-0000-4000-8000-0000000000d3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ') $$,
  '23514', null,
  'тело из одних пробелов отклоняется: btrim обнуляет длину'
);

select throws_ok(
  $$ insert into public.project_messages (id, project_id, body)
     values ('e0000000-0000-4000-8000-0000000000d4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('a', 2001)) $$,
  '23514', null,
  'тело длиннее 2000 символов отклоняется CHECK'
);

-- ================= Удаление своего сообщения =================

delete from public.project_messages where id = 'e0000000-0000-4000-8000-0000000000a2';

select is(
  (select count(*)::int from public.project_messages
    where id = 'e0000000-0000-4000-8000-0000000000a2'),
  0,
  'своё сообщение удаляется'
);

-- ================= Отметки о прочитанном =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

insert into public.project_message_reads (project_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.project_message_reads
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'участник пишет свою отметку о прочитанном'
);

select throws_ok(
  $$ insert into public.project_message_reads (project_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'чужую отметку записать нельзя: RLS требует user_id = auth.uid()'
);

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

select is(
  (select count(*)::int from public.project_message_reads
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'отметки других участников не видны'
);

-- ================= Чистка старше 12 месяцев =================

reset role;

insert into public.project_messages (id, project_id, author_id, body, created_at) values
  ('e0000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'Старое сообщение', now() - interval '13 months'),
  ('e0000000-0000-4000-8000-0000000000f2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'Свежее сообщение', now());

select public.purge_project_messages();

select is(
  (select count(*)::int from public.project_messages
    where id = 'e0000000-0000-4000-8000-0000000000f1'),
  0,
  'purge_project_messages удаляет сообщения старше 12 месяцев'
);

select is(
  (select count(*)::int from public.project_messages
    where id = 'e0000000-0000-4000-8000-0000000000f2'),
  1,
  'purge_project_messages не трогает свежие сообщения'
);

-- ================= Realtime =================

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_messages'),
  1,
  'project_messages добавлена в публикацию supabase_realtime'
);

select * from finish();

rollback;
