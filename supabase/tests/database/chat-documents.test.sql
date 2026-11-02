-- Документы в чате и уборка сирот по активности (0038): вид вложения,
-- nullable-размеры, согласованность расширения и mime, claim/release уборки.

create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'chat-doc-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'chat-doc-owner-b@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'chat-doc-member-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.project_messages (id, project_id, author_id, body) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'сообщение в A'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'сообщение в B');

-- ================= Таблица: вид, размеры, путь =================

-- 1. Документ: размеров нет, имя файла сохранено.
select lives_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name)
     values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1000000-0000-4000-8000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.pdf',
       2048, 'document', 'application/pdf', 'смета.pdf'
     ) $$,
  'документ без размеров принимается'
);

-- 2. Картинка без размеров — отказ.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name)
     values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1000000-0000-4000-8000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000002.jpg',
       1024, 'image', 'image/jpeg', 'фото.jpg'
     ) $$,
  '23514',
  null,
  'картинка без ширины и высоты отклоняется'
);

-- 3. Документ с размерами — отказ.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name, width, height)
     values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1000000-0000-4000-8000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000003.pdf',
       2048, 'document', 'application/pdf', 'смета.pdf', 100, 100
     ) $$,
  '23514',
  null,
  'у документа не может быть размеров'
);

-- 4. Расширение и mime не совпадают.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name)
     values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1000000-0000-4000-8000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000004.pdf',
       2048, 'document', 'image/jpeg', 'смета.pdf'
     ) $$,
  '23514',
  null,
  'pdf с типом jpeg отклоняется'
);

-- 5. Недопустимое расширение.
select throws_ok(
  $$ insert into public.project_message_attachments
       (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name)
     values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1000000-0000-4000-8000-000000000001',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000005.exe',
       2048, 'document', 'application/pdf', 'вирус.exe'
     ) $$,
  '23514',
  null,
  'исполняемый файл отклоняется'
);

-- 6. Метаданные выводятся из пути, если не переданы.
insert into public.project_message_attachments
  (project_id, message_id, storage_path, size_bytes)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a1000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000006.xlsx',
  4096
);

select is(
  (select kind || '|' || mime_type || '|' || file_name
     from public.project_message_attachments
    where storage_path like '%f0000000-0000-4000-8000-000000000006.xlsx'),
  'document|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|f0000000-0000-4000-8000-000000000006.xlsx',
  'вид, тип и имя файла выводятся из пути'
);

-- ================= RPC от имени владельца A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 7. Документ через RPC.
select lives_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000001',
       '',
       '[{"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000007.pdf",
          "size_bytes": 1024, "kind": "document", "mime_type": "application/pdf",
          "file_name": "акт.pdf"}]'::jsonb
     ) $$,
  'RPC принимает документ без текста'
);

-- 8. Картинка без размеров через RPC.
select throws_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000002',
       'фото',
       '[{"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000002/f0000000-0000-4000-8000-000000000008.jpg",
          "size_bytes": 1024, "kind": "image", "mime_type": "image/jpeg"}]'::jsonb
     ) $$,
  '22023',
  'attachment_image_size_missing',
  'RPC требует размеры у картинки'
);

-- 9. Пять вложений.
select throws_ok(
  $$ select public.create_chat_message(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a2000000-0000-4000-8000-000000000003',
       'пять',
       '[{"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000011.jpg", "size_bytes": 1, "kind": "image", "mime_type": "image/jpeg", "width": 1, "height": 1},
         {"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000012.jpg", "size_bytes": 1, "kind": "image", "mime_type": "image/jpeg", "width": 1, "height": 1},
         {"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000013.jpg", "size_bytes": 1, "kind": "image", "mime_type": "image/jpeg", "width": 1, "height": 1},
         {"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000014.jpg", "size_bytes": 1, "kind": "image", "mime_type": "image/jpeg", "width": 1, "height": 1},
         {"path": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000015.jpg", "size_bytes": 1, "kind": "image", "mime_type": "image/jpeg", "width": 1, "height": 1}]'::jsonb
     ) $$,
  '22023',
  'attachments_too_many',
  'RPC отклоняет больше четырёх вложений'
);

-- ================= Уборка: claim / release =================

select is(public.claim_chat_cleanup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true,
  'первый вызов выкупает уборку');
select is(public.claim_chat_cleanup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false,
  'повторный вызов сразу — отказ');

select public.release_chat_cleanup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(public.claim_chat_cleanup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true,
  'после release уборку снова можно запускать');

-- 13. Чужой проект: у владельца B нет прав в A.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
select is(public.claim_chat_cleanup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false,
  'чужой проект уборку не выкупает');

select * from finish();

rollback;
