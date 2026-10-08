-- Поиск файлов-«сирот» в bucket task-attachments (0026): public.task_attachment_orphans.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(9);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A, D — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'orph-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'orph-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'orph-viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'orph-member-d@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.tasks (id, project_id, title) values
  ('e2000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e2000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A2'),
  ('e2000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Task B');

insert into storage.buckets (id, name, public) values ('orphans-test-other', 'orphans-test-other', false);

-- O1 — сирота 2 дня, O2 — сирота 3 дня (старше, идёт первой), F — свежая сирота,
-- L — файл со строкой, BO — сирота проекта B, X — тот же префикс в другом bucket.
insert into storage.objects (bucket_id, name, created_at) values
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000001.jpg', now() - interval '2 days'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg', now() - interval '3 days'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000003.jpg', now() - interval '1 hour'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000004.jpg', now() - interval '2 days'),
  ('task-attachments', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e2000000-0000-0000-0000-00000000000b/f2000000-0000-0000-0000-000000000005.jpg', now() - interval '2 days'),
  ('orphans-test-other', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000006.jpg', now() - interval '2 days');

insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e2000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000004.jpg',
   1000, 10, 10);

-- 1-2
select has_function('public', 'task_attachment_orphans', array['uuid', 'integer'], 'task_attachment_orphans exists');
select ok(
  not has_function_privilege('anon', 'public.task_attachment_orphans(uuid, integer)', 'execute'),
  'anon cannot execute task_attachment_orphans'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Только старые сироты своего проекта в этом bucket, старшая первой
select is(
  array(select public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  array[
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000001.jpg'
  ],
  'old orphans of own project only, oldest first'
);

-- 4. p_limit ограничивает выборку
select is(
  array(select public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1)),
  array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg'],
  'p_limit limits the result'
);

-- 5. Некорректный предел приводится к 1, а не к ошибке
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0)),
  1::bigint,
  'non-positive p_limit is clamped to 1'
);

-- 6. Чужой проект — пусто
select is(
  (select count(*) from public.task_attachment_orphans('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  0::bigint,
  'foreign project gives nothing'
);

reset role;

-- ================= Member D =================

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 7. Редактор видит те же сироты
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  2::bigint,
  'member gets the same orphans'
);

-- 8. Файл со строкой не сирота и для редактора
select ok(
  not exists (
    select 1 from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as p(path)
      where p.path like '%f2000000-0000-0000-0000-000000000004.jpg'
  ),
  'file with an attachment row is never an orphan'
);

reset role;

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 9. Наблюдатель удалять не может — пусто
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0::bigint,
  'viewer gets nothing'
);

reset role;

select * from finish();

rollback;
