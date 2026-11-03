-- Ответы на сообщения (0039): снимок цитаты, проверка адресата, поведение при
-- удалении оригинала. Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(7);

-- ================= Фикстуры =================
-- Пишем как postgres, минуя RLS: проверяем триггер и FK, а не политики.

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'reply-owner-a@example.com'),
  ('b2000000-0000-4000-8000-000000000002', 'reply-owner-b@example.com');

insert into public.projects (id, owner_id, name) values
  ('aa110000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Reply Project A'),
  ('bb220000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Reply Project B');

insert into public.project_messages (id, project_id, author_id, body, created_at) values
  ('aa110000-0000-4000-8000-0000000000a1', 'aa110000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Оригинал в проекте A', '2026-01-01T09:00:00Z'),
  ('bb220000-0000-4000-8000-0000000000b2', 'bb220000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000002', 'Оригинал в проекте B', '2026-01-01T09:05:00Z');

-- ================= Колонка =================

select has_column(
  'public', 'project_messages', 'reply_to_id',
  'у сообщений есть колонка reply_to_id'
);

-- ================= Ответ заполняет снимок =================

insert into public.project_messages (id, project_id, author_id, body, reply_to_id) values
  ('aa110000-0000-4000-8000-0000000000c3', 'aa110000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000002', 'Отвечаю в A',
   'aa110000-0000-4000-8000-0000000000a1');

select is(
  (select reply_to_body from public.project_messages
    where id = 'aa110000-0000-4000-8000-0000000000c3'),
  'Оригинал в проекте A',
  'триггер записал текст оригинала в снимок'
);

select is(
  (select reply_to_author_id from public.project_messages
    where id = 'aa110000-0000-4000-8000-0000000000c3'),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'триггер записал автора оригинала'
);

-- ================= Ошибки адресата =================

select throws_ok(
  $$ insert into public.project_messages (id, project_id, author_id, body, reply_to_id)
     values ('aa110000-0000-4000-8000-0000000000d4', 'aa110000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-000000000001', 'в пустоту',
             'ffffffff-ffff-4fff-8fff-ffffffffffff') $$,
  '22023',
  'reply_target_invalid',
  'ответ на несуществующее сообщение отклоняется'
);

select throws_ok(
  $$ insert into public.project_messages (id, project_id, author_id, body, reply_to_id)
     values ('aa110000-0000-4000-8000-0000000000e5', 'aa110000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-000000000001', 'в чужой проект',
             'bb220000-0000-4000-8000-0000000000b2') $$,
  '22023',
  'reply_target_invalid',
  'нельзя ответить на сообщение другого проекта'
);

-- ================= Удаление оригинала =================
-- FK стоит с on delete set null, но снимок обязан остаться: иначе ответ
-- перестал бы выглядеть ответом, и «Сообщение удалено» показать было бы нечем.

delete from public.project_messages where id = 'aa110000-0000-4000-8000-0000000000a1';

select ok(
  (select reply_to_id is null from public.project_messages
    where id = 'aa110000-0000-4000-8000-0000000000c3'),
  'после удаления оригинала ссылка обнулилась'
);

select is(
  (select reply_to_body from public.project_messages
    where id = 'aa110000-0000-4000-8000-0000000000c3'),
  'Оригинал в проекте A',
  'снимок текста пережил удаление оригинала'
);

select * from finish();
rollback;
