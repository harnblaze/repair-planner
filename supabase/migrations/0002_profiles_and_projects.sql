-- Профили, проекты, членство и функция доступа к проекту.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Профиль создаётся автоматически при регистрации пользователя.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Проекты

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  timezone text not null default 'Europe/Moscow',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create or replace function public.validate_project_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'invalid timezone: %', new.timezone;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_validate_timezone on public.projects;
create trigger projects_validate_timezone
  before insert or update on public.projects
  for each row execute function public.validate_project_timezone();

alter table public.projects enable row level security;

-- Членство в проекте. Единственный источник правды о доступе — владелец тоже присутствует здесь.

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_id_idx on public.project_members (user_id);

alter table public.project_members enable row level security;

-- Функция доступа к проекту. SECURITY DEFINER и обход RLS необходимы, чтобы
-- policy на project_members и policy на projects не читали друг друга и не
-- уходили в рекурсию.

create or replace function public.project_access(p_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = (select auth.uid())
$$;

revoke all on function public.project_access(uuid) from public;
grant execute on function public.project_access(uuid) to authenticated;

-- Политики projects

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select to authenticated
  using (public.project_access(id) is not null);

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update to authenticated
  using (public.project_access(id) = 'owner')
  with check (public.project_access(id) = 'owner');

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete to authenticated
  using (public.project_access(id) = 'owner');

-- Политики project_members: изменения только владельцем проекта.

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "project_members_insert" on public.project_members;
create policy "project_members_insert" on public.project_members for insert to authenticated
  with check (public.project_access(project_id) = 'owner');

drop policy if exists "project_members_update" on public.project_members;
create policy "project_members_update" on public.project_members for update to authenticated
  using (public.project_access(project_id) = 'owner')
  with check (public.project_access(project_id) = 'owner');

drop policy if exists "project_members_delete" on public.project_members;
create policy "project_members_delete" on public.project_members for delete to authenticated
  using (public.project_access(project_id) = 'owner');

-- При создании проекта его владелец становится участником с ролью owner.
-- Системные board_lists добавляются в миграции 0006, когда появится таблица.

create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner');

  return new;
end;
$$;

drop trigger if exists projects_after_insert on public.projects;
create trigger projects_after_insert
  after insert on public.projects
  for each row execute function public.handle_new_project();
