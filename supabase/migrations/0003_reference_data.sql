-- Справочники проекта: категории (цеха-заказчики), исполнители, материалы.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  color text,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists categories_project_sort_idx on public.categories (project_id, sort_order);
create unique index if not exists categories_project_name_key
  on public.categories (project_id, lower(name)) where not is_archived;

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;

drop policy if exists "categories_select" on public.categories;
create policy "categories_select" on public.categories for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "categories_insert" on public.categories;
create policy "categories_insert" on public.categories for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "categories_update" on public.categories;
create policy "categories_update" on public.categories for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "categories_delete" on public.categories;
create policy "categories_delete" on public.categories for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Исполнители

create table if not exists public.executors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  position text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists executors_project_active_idx on public.executors (project_id, is_active);

drop trigger if exists executors_set_updated_at on public.executors;
create trigger executors_set_updated_at
  before update on public.executors
  for each row execute function public.set_updated_at();

alter table public.executors enable row level security;

drop policy if exists "executors_select" on public.executors;
create policy "executors_select" on public.executors for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "executors_insert" on public.executors;
create policy "executors_insert" on public.executors for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "executors_update" on public.executors;
create policy "executors_update" on public.executors for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "executors_delete" on public.executors;
create policy "executors_delete" on public.executors for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Материалы

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  unit text not null,
  current_balance numeric(14, 3) not null default 0,
  minimum_balance numeric(14, 3) not null default 0 check (minimum_balance >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists materials_project_active_idx on public.materials (project_id, is_active);
create index if not exists materials_low_balance_idx
  on public.materials (project_id) where current_balance <= minimum_balance;
create unique index if not exists materials_project_name_key on public.materials (project_id, lower(name));

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at
  before update on public.materials
  for each row execute function public.set_updated_at();

-- current_balance — кеш. Меняют его только функции движения материалов (см. 0005),
-- напрямую клиентом менять бессмысленно и запрещается этим триггером-стражем.

create or replace function public.guard_materials_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_balance is distinct from old.current_balance
     and coalesce(current_setting('repair_planner.balance_update', true), '') <> 'on' then
    raise exception 'current_balance can only be changed by material movement functions';
  end if;
  return new;
end;
$$;

drop trigger if exists materials_guard_balance on public.materials;
create trigger materials_guard_balance
  before update on public.materials
  for each row execute function public.guard_materials_balance();

alter table public.materials enable row level security;

drop policy if exists "materials_select" on public.materials;
create policy "materials_select" on public.materials for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "materials_insert" on public.materials;
create policy "materials_insert" on public.materials for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "materials_update" on public.materials;
create policy "materials_update" on public.materials for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "materials_delete" on public.materials;
create policy "materials_delete" on public.materials for delete to authenticated
  using (public.project_access(project_id) is not null);
