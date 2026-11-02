-- Фото к сообщениям чата (0037): таблица project_message_attachments,
-- bucket chat-attachments, RPC create_chat_message и chat_attachment_orphans.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(20);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A, D — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'chat-att-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'chat-att-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'chat-att-viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'chat-att-member-d@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

-- Два сообщения в A (для проверки пути «чужого» сообщения) и одно в B.
insert into public.project_messages (id, project_id, author_id, body) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'первое'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'второе'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'чужое');

-- ================= Bucket =================

select is((select public from storage.buckets where id = 'chat-attachments'), false, 'bucket is private');
select is(
  (select allowed_mime_types from storage.buckets where id = 'chat-attachments'),
  array[
    'image/jpeg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]::text[],
  'bucket accepts photos and documents'
);
select is(
  (select file_size_limit from storage.buckets where id = 'chat-attachments'),
  26214400::bigint,
  'bucket limits files to 25 MB'
);

-- ================= Владелец A: RPC =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- Сообщение без текста, но с фото — разрешено.
select lives_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000001',
       '',
       '[{"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.jpg",
          "size_bytes": 1000, "width": 800, "height": 600}]'::jsonb
     ) $$,
  'message with an attachment but without text is created'
);

select is(
  (select count(*)::int from public.project_message_attachments
    where message_id = 'a2000000-0000-4000-8000-000000000001'),
  1,
  'attachment row is written in the same transaction'
);

-- Совсем пустое сообщение — отказ с понятным кодом.
select throws_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000002',
       '   ',
       '[]'::jsonb
     ) $$,
  '22023', 'message_empty',
  'empty message without attachments is rejected by the RPC'
);

-- Больше четырёх фото нельзя.
select throws_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000003',
       'текст',
       '[{"path": "x"}, {"path": "x"}, {"path": "x"}, {"path": "x"}, {"path": "x"}]'::jsonb
     ) $$,
  '22023', 'attachments_too_many',
  'more than four attachments are rejected'
);

-- Путь чужого сообщения — отказ.
select throws_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000004',
       'текст',
       '[{"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000009.jpg",
          "size_bytes": 1000, "width": 10, "height": 10}]'::jsonb
     ) $$,
  '22023', 'attachment_path_mismatch',
  'attachment path of another message is rejected by the RPC'
);

-- CHECK пути в таблице ловит то же самое даже в обход RPC.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-00000000000a.jpg',
      1000, 10, 10) $$,
  '23514', null,
  'storage_path of another message is rejected by the check constraint'
);

-- Отложенный триггер: пустое сообщение без вложений отклоняется на проверке.
-- В тесте транзакция откатывается, поэтому переводим констрейнт в immediate.
set constraints project_messages_body_or_attachment immediate;

select throws_ok(
  $$ insert into public.project_messages (id, project_id, body) values
     ('a1000000-0000-4000-8000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ') $$,
  '23514', null,
  'deferred trigger rejects an empty message without attachments'
);

set constraints project_messages_body_or_attachment deferred;

-- ================= Изоляция проектов =================

-- Владелец B не видит вложения проекта A.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

select is(
  (select count(*)::int from public.project_message_attachments
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'owner of another project sees no attachments'
);

-- И не может вставить вложение к чужому сообщению.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-00000000000b.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'owner of another project cannot attach a file to a foreign message'
);

-- ================= Роли внутри проекта =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-00000000000c.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'viewer cannot attach files'
);

select is(
  (select count(*)::int from public.project_message_attachments
    where message_id = 'a2000000-0000-4000-8000-000000000001'),
  1,
  'viewer sees attachments of the project'
);

-- ================= Storage: políticas =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('chat-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-0000000000d1.jpg') $$,
  'owner uploads an object into own project folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('chat-attachments', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-0000000000d2.jpg') $$,
  '42501', null,
  'owner cannot upload into a foreign project folder'
);

reset role;

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'chat_attachments_%'),
  3,
  'storage.objects has three policies for the chat bucket'
);

-- ================= Каскад и сироты =================

-- Строки вложений уходят вместе с сообщением.
delete from public.project_messages where id = 'a2000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.project_message_attachments
    where message_id = 'a2000000-0000-4000-8000-000000000001'),
  0,
  'attachments are deleted together with the message'
);

-- O — сирота двухдневной давности, F — свежая (моложе суток), L — с строкой.
insert into storage.objects (bucket_id, name, created_at) values
  ('chat-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-0000000000e1.jpg', now() - interval '2 days'),
  ('chat-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-0000000000e2.jpg', now() - interval '1 hour');

insert into public.project_message_attachments
  (project_id, message_id, storage_path, size_bytes, width, height) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000002',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-0000000000e3.jpg',
   1000, 10, 10);

insert into storage.objects (bucket_id, name, created_at) values
  ('chat-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-0000000000e3.jpg', now() - interval '3 days');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

select is(
  (select count(*)::int from public.chat_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  1,
  'orphans lists only the old file without a row'
);

select is(
  (select public.chat_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-0000000000e1.jpg',
  'orphans returns exactly the old orphan'
);

reset role;

select * from finish();

rollback;
