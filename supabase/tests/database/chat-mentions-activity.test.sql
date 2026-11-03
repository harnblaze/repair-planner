-- Упоминания в чате → лента проекта (0040).
-- Запуск: supabase test db
--
-- Проверяем: событие создаётся на упомянутого участника, не создаётся без «@»,
-- на самого себя, на «почти имя» (@Иванов при участнике «Иван»), на человека
-- из другого проекта; повторная вставка сообщения невозможна; правка текста
-- новых событий не даёт.

create extension if not exists pgtap with schema extensions;

begin;

select plan(15);

-- ================= Фикстуры (как postgres, минуя RLS) =================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'mention-owner@example.com', '{"full_name": "Станислав Белов"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'mention-member@example.com', '{"full_name": "Дмитрий"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'mention-ivan@example.com', '{"full_name": "Иван"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'mention-other@example.com', '{"full_name": "Пётр"}'::jsonb);

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Проект с чатом'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'Чужой проект');

-- Владельца в project_members не вставляем: его добавляет триггер проекта.
insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member');

-- ================= Упоминание участника =================

insert into public.project_messages (id, project_id, author_id, body) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Станислав Белов проверь заявку, электроды пришли');

select is(
  (select kind from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000001'),
  'chat_mention',
  'упоминание пишет событие chat_mention'
);

select is(
  (select entity_type from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000001'),
  'chat_message',
  'entity_type — chat_message'
);

select is(
  (select payload->>'mentioned' from public.project_activity
    where entity_id = 'c0000000-0000-4000-8000-000000000001'),
  'Станислав Белов',
  'в payload лежит имя упомянутого'
);

select is(
  (select payload->>'message_id' from public.project_activity
    where entity_id = 'c0000000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000001',
  'в payload лежит id сообщения'
);

select ok(
  (select payload->>'excerpt' from public.project_activity
    where entity_id = 'c0000000-0000-4000-8000-000000000001') like '%электроды%',
  'excerpt содержит текст сообщения'
);

select is(
  (select count(*)::int from public.project_activity
    where kind = 'chat_mention' and entity_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'одно упоминание — одна запись'
);

-- ================= Негативные случаи =================

insert into public.project_messages (id, project_id, author_id, body) values
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', 'просто текст без упоминаний'),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Дмитрий отметил сам себя'),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Иванов привет'),
  ('c0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Пётр посмотри, это из другого проекта');

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000002'),
  0,
  'сообщение без «@» событий не пишет'
);

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000003'),
  0,
  'упоминание самого себя событий не пишет'
);

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000004'),
  0,
  '«@Иванов» не считается упоминанием участника «Иван»'
);

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000005'),
  0,
  'участник другого проекта не упоминается'
);

-- ================= Границы слова и несколько упоминаний =================

insert into public.project_messages (id, project_id, author_id, body) values
  ('c0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Иван, посмотри заявку');

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000006'),
  1,
  '«@Иван,» — это упоминание участника «Иван»'
);

insert into public.project_messages (id, project_id, author_id, body) values
  ('c0000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@Станислав Белов и @Иван — посмотрите заявку');

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000007'),
  2,
  'два упоминания — две записи'
);

-- ================= Повтор и правка =================

select throws_ok(
  $$ insert into public.project_messages (id, project_id, author_id, body)
     values ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '22222222-2222-2222-2222-222222222222', '@Станислав Белов ещё раз') $$,
  '23505',
  null,
  'повторная вставка сообщения с тем же id не проходит'
);

update public.project_messages
   set body = '@Станислав Белов и @Иван — снова'
 where id = 'c0000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.project_activity
    where kind = 'chat_mention' and entity_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'правка текста новых событий не создаёт'
);

-- Кириллица без учёта регистра: имя в тексте набрано строчными.
insert into public.project_messages (id, project_id, author_id, body) values
  ('c0000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', '@станислав белов посмотри');

select is(
  (select count(*)::int from public.project_activity where entity_id = 'c0000000-0000-4000-8000-000000000008'),
  1,
  'регистр не важен: строчные буквы тоже упоминают'
);

select * from finish();

rollback;
