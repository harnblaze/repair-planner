-- Правка своих сообщений (0036): edited_at, UPDATE-политика, запрет на чужое.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(10);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'edit-owner-a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'edit-member-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Edit Project A');

-- Владельца в project_members не вставляем: его добавляет триггер проекта.
insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member');

-- ================= Владелец A: своё сообщение =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

insert into public.project_messages (id, project_id, body, created_at) values
  ('e1000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Исходный текст', '2026-01-01T09:00:00Z');

update public.project_messages
   set body = 'Исправленный текст'
 where id = 'e1000000-0000-4000-8000-0000000000a1';

select is(
  (select body from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  'Исправленный текст',
  'автор может изменить своё сообщение'
);

select ok(
  (select edited_at is not null from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  'триггер проставляет edited_at'
);

select is(
  (select author_id from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'правка не меняет автора'
);

select is(
  (select created_at from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  '2026-01-01T09:00:00Z'::timestamptz,
  'правка не меняет дату создания'
);

-- ================= Участник C: чужое сообщение =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- Сначала своё сообщение C и реакция на него — понадобятся для каскада.
insert into public.project_messages (id, project_id, body) values
  ('e1000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сообщение участника');

insert into public.project_message_reactions (message_id, user_id, emoji) values
  ('e1000000-0000-4000-8000-0000000000c1', '33333333-3333-3333-3333-333333333333', '👍');

-- Чужое сообщение править нельзя: политика отсекает строку, тело не меняется.
update public.project_messages
   set body = 'Подмена чужого'
 where id = 'e1000000-0000-4000-8000-0000000000a1';

select is(
  (select body from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  'Исправленный текст',
  'чужое сообщение изменить нельзя'
);

-- Пустое тело отклоняет CHECK из 0033 — правка не должна его обходить.
select throws_ok(
  $$ update public.project_messages set body = '   ' where id = 'e1000000-0000-4000-8000-0000000000c1' $$,
  '23514',
  null,
  'пустое тело после правки отклоняется'
);

-- Чужое удалить нельзя.
delete from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1';

select ok(
  exists (select 1 from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000a1'),
  'чужое сообщение удалить нельзя'
);

-- Своё удалить можно, и реакции уходят каскадом.
delete from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000c1';

select ok(
  not exists (select 1 from public.project_messages where id = 'e1000000-0000-4000-8000-0000000000c1'),
  'своё сообщение удаляется'
);

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e1000000-0000-4000-8000-0000000000c1'),
  0,
  'реакции удалённого сообщения уходят каскадом'
);

-- Политика UPDATE должна существовать: без неё правка молча не сработает.
reset role;

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'project_messages'
       and policyname = 'project_messages_update'
  ),
  'у сообщений есть UPDATE-политика'
);

select * from finish();

rollback;
