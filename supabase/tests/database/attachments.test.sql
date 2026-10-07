-- Фото к задачам (0017): RLS таблицы task_attachments и storage.objects
-- в bucket task-attachments. Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(28);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A, D — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'att-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'att-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'att-viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'att-member-d@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.tasks (id, project_id, title) values
  ('e1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e1000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A2'),
  ('e1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Task B');

-- ================= Bucket =================

-- 1-3
select is((select public from storage.buckets where id = 'task-attachments'), false, 'bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'task-attachments'), array['image/jpeg']::text[], 'bucket accepts only image/jpeg');
select is((select file_size_limit from storage.buckets where id = 'task-attachments'), 10485760::bigint, 'bucket limits files to 10 MB');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 4. Строка для своей задачи
select lives_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001.jpg',
      1000, 2000, 1500) $$,
  'owner inserts an attachment row for own task'
);

-- 5. Путь другой задачи того же проекта отклоняется CHECK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-0000000000a2/f0000000-0000-0000-0000-000000000002.jpg',
      1000, 10, 10) $$,
  '23514', null,
  'storage_path of another task is rejected by the check constraint'
);

-- 6. Путь не вида {uuid}.jpg отклоняется CHECK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/../x.jpg',
      1000, 10, 10) $$,
  '23514', null,
  'storage_path with extra segments is rejected by the check constraint'
);

-- 7. Задача проекта B под project_id A — составной FK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000b',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000003.jpg',
      1000, 10, 10) $$,
  '23503', null,
  'cross-project task_id is rejected by the composite foreign key'
);

-- 8. Строка в чужом проекте — RLS
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e1000000-0000-0000-0000-00000000000b',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000004.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'owner A cannot insert an attachment into project B'
);

-- 9. UPDATE строк запрещён (политики нет)
with upd as (
  update public.task_attachments set width = 1
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from upd), 0::bigint, 'attachment rows cannot be updated');

-- 10. Объект Storage в своём проекте
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001.jpg') $$,
  'owner uploads an object into own project folder'
);

-- 11. Объект в папке чужого проекта
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000005.jpg') $$,
  '42501', null,
  'owner A cannot upload into project B folder'
);

-- 12. Мусорная первая папка — отказ RLS, а не ошибка приведения к uuid
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('task-attachments', 'not-a-uuid/x.jpg') $$,
  '42501', null,
  'object with a non-uuid first folder is denied, not a cast error'
);

-- 13. UPDATE объектов запрещён (политики нет)
with upd as (
  update storage.objects set name = name || '.moved'
    where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from upd), 0::bigint, 'attachment objects cannot be updated');

-- ================= Пользователь B: нет доступа к проекту A =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
select set_config('storage.allow_delete_query', 'true', true) as _;
set role authenticated;

-- 14-17
select is(
  (select count(*) from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint, 'user B cannot see attachment rows of project A'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'task-attachments'),
  0::bigint, 'user B cannot see attachment objects of project A'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'user B cannot delete attachment rows of project A');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 0::bigint, 'user B cannot delete attachment objects of project A');

-- ================= Viewer C: только чтение =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 18-23
select is(
  (select count(*) from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint, 'viewer sees attachment rows'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'task-attachments'),
  1::bigint, 'viewer sees attachment objects'
);
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000006.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'viewer cannot insert attachment rows'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000006.jpg') $$,
  '42501', null,
  'viewer cannot upload attachment objects'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete attachment rows');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete attachment objects');

-- ================= Member D: редактирует =================

reset role;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 24-26
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-0000000000a2/f0000000-0000-0000-0000-000000000007.jpg') $$,
  'member uploads an object into the project folder'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 1::bigint, 'member deletes attachment rows');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 2::bigint, 'member deletes attachment objects');

-- ================= anon и права на helper =================

reset role;
set role anon;

-- 27
select is((select count(*) from public.task_attachments), 0::bigint, 'anon sees no attachment rows');

reset role;

-- 28
select ok(
  not has_function_privilege('anon', 'private.attachment_project_id(text)', 'execute'),
  'anon cannot execute private.attachment_project_id'
);

select * from finish();

rollback;
