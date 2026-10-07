-- Фото к задачам (docs/superpowers/specs/2026-10-07-task-attachments-design.md).
--
-- Файлы лежат в приватном bucket task-attachments по пути
-- {project_id}/{task_id}/{uuid}.jpg; путь выбирает сервер. Доступ — двумя
-- слоями: RLS таблицы task_attachments (по проекту, связь с задачей через
-- составной FK и CHECK пути) и RLS storage.objects (по первой папке пути).
-- Service role не используется.

-- ================= Таблица =================

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid not null,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  -- Путь принадлежит именно этой задаче этого проекта и имеет вид {uuid}.jpg.
  constraint task_attachments_path_matches_task check (
    storage_path ~ ('^' || project_id::text || '/' || task_id::text
                    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
);

create index if not exists task_attachments_task_idx
  on public.task_attachments (task_id, created_at);

-- ================= RLS таблицы =================
-- SELECT — любой участник; INSERT/DELETE — owner, member; UPDATE — никто.

alter table public.task_attachments enable row level security;

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments
  for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments
  for insert to authenticated
  with check (public.project_can_edit(project_id));

drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments
  for delete to authenticated
  using (public.project_can_edit(project_id));

-- ================= Bucket =================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ================= RLS storage.objects =================

-- project_id из первой папки пути или null, если это не uuid. Приведение
-- внутри CASE: некорректное имя даёт отказ политики, а не ошибку 22P02.
create or replace function private.attachment_project_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

revoke all on function private.attachment_project_id(text) from public, anon;
grant execute on function private.attachment_project_id(text) to authenticated;

-- project_access(null) и project_can_edit(null) дают отказ.
drop policy if exists task_attachments_objects_select on storage.objects;
create policy task_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.project_access(private.attachment_project_id(name)) is not null
  );

drop policy if exists task_attachments_objects_insert on storage.objects;
create policy task_attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );

drop policy if exists task_attachments_objects_delete on storage.objects;
create policy task_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );
