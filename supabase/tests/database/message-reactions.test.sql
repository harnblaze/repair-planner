-- Реакции на сообщения (0035): RLS по проекту, авторство, уникальность,
-- фиксированный набор эмодзи, каскад и публикация Realtime.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(9);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'react-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'react-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'react-member-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'React Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'React Project B');

-- Владельца в project_members не вставляем: его добавляет триггер проекта.
insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member');

-- Сообщения: m1 — в проекте A (автор A), m2 — в проекте B (автор B).
insert into public.project_messages (id, project_id, author_id, body) values
  ('e0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Сообщение проекта A'),
  ('e0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Сообщение проекта B');

-- Владелец A ставит две разные реакции на своё сообщение (это разрешено).
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

insert into public.project_message_reactions (message_id, user_id, emoji) values
  ('e0000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111', '👍'),
  ('e0000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111', '❤️');

-- Владелец B — реакция на сообщение своего проекта.
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

insert into public.project_message_reactions (message_id, user_id, emoji) values
  ('e0000000-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222', '👍');

-- ================= Участник C: видит только свой проект =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e0000000-0000-4000-8000-0000000000a1'),
  2,
  'участник видит реакции сообщения своего проекта'
);

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e0000000-0000-4000-8000-0000000000b1'),
  0,
  'реакции чужого проекта не видны'
);

-- ================= Подделка автора и ограничения =================

select throws_ok(
  $$ insert into public.project_message_reactions (message_id, user_id, emoji)
     values ('e0000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111', '🎉') $$,
  '42501',
  null,
  'нельзя поставить реакцию от чужого имени'
);

insert into public.project_message_reactions (message_id, user_id, emoji) values
  ('e0000000-0000-4000-8000-0000000000a1', '33333333-3333-3333-3333-333333333333', '👍');

select throws_ok(
  $$ insert into public.project_message_reactions (message_id, user_id, emoji)
     values ('e0000000-0000-4000-8000-0000000000a1', '33333333-3333-3333-3333-333333333333', '👍') $$,
  '23505',
  null,
  'одну и ту же реакцию дважды поставить нельзя'
);

select throws_ok(
  $$ insert into public.project_message_reactions (message_id, user_id, emoji)
     values ('e0000000-0000-4000-8000-0000000000a1', '33333333-3333-3333-3333-333333333333', '🍕') $$,
  '23514',
  null,
  'эмодзи вне набора отвергается CHECK'
);

-- ================= Снять можно только свою =================

delete from public.project_message_reactions
 where message_id = 'e0000000-0000-4000-8000-0000000000a1'
   and user_id = '33333333-3333-3333-3333-333333333333'
   and emoji = '👍';

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e0000000-0000-4000-8000-0000000000a1'
      and user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'свою реакцию можно снять'
);

delete from public.project_message_reactions
 where message_id = 'e0000000-0000-4000-8000-0000000000a1'
   and user_id = '11111111-1111-1111-1111-111111111111'
   and emoji = '❤️';

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e0000000-0000-4000-8000-0000000000a1'
      and user_id = '11111111-1111-1111-1111-111111111111'
      and emoji = '❤️'),
  1,
  'чужую реакцию снять нельзя'
);

-- ================= Публикация Realtime =================

reset role;

select ok(
  exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'project_message_reactions'
  ),
  'project_message_reactions есть в публикации supabase_realtime'
);

-- ================= Каскад при удалении сообщения =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

delete from public.project_messages where id = 'e0000000-0000-4000-8000-0000000000a1';

-- Считаем как postgres: политика SELECT у реакций смотрит на живое сообщение,
-- и после удаления она вернула бы ноль при любом раскладе — проверка была бы пустой.
reset role;

select is(
  (select count(*)::int from public.project_message_reactions
    where message_id = 'e0000000-0000-4000-8000-0000000000a1'),
  0,
  'при удалении сообщения реакции уходят каскадом'
);

select * from finish();

rollback;
