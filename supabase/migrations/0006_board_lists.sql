-- Универсальные дополнительные списки: board_lists и board_items.
-- «Текущие заявки» сюда не входят — это задачи без записей в task_schedule (см. architecture.md §6).

create table if not exists public.board_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

drop trigger if exists board_lists_set_updated_at on public.board_lists;
create trigger board_lists_set_updated_at
  before update on public.board_lists
  for each row execute function public.set_updated_at();

alter table public.board_lists enable row level security;

drop policy if exists "board_lists_select" on public.board_lists;
create policy "board_lists_select" on public.board_lists for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "board_lists_insert" on public.board_lists;
create policy "board_lists_insert" on public.board_lists for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "board_lists_update" on public.board_lists;
create policy "board_lists_update" on public.board_lists for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

-- Системные списки нельзя удалить, только переименовать.
drop policy if exists "board_lists_delete" on public.board_lists;
create policy "board_lists_delete" on public.board_lists for delete to authenticated
  using (public.project_access(project_id) is not null and not is_system);

-- Элементы списков

create table if not exists public.board_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  list_id uuid not null,
  title text not null,
  note text,
  is_done boolean not null default false,
  due_date date,
  position int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (list_id, project_id) references public.board_lists (id, project_id) on delete cascade
);

create index if not exists board_items_project_list_position_idx on public.board_items (project_id, list_id, position);

drop trigger if exists board_items_set_updated_at on public.board_items;
create trigger board_items_set_updated_at
  before update on public.board_items
  for each row execute function public.set_updated_at();

alter table public.board_items enable row level security;

drop policy if exists "board_items_select" on public.board_items;
create policy "board_items_select" on public.board_items for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "board_items_insert" on public.board_items;
create policy "board_items_insert" on public.board_items for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "board_items_update" on public.board_items;
create policy "board_items_update" on public.board_items for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "board_items_delete" on public.board_items;
create policy "board_items_delete" on public.board_items for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Расширяем триггер создания проекта (0002): теперь он также заводит три
-- системных списка. CREATE OR REPLACE сохраняет существующий триггер на projects.

create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner');

  insert into public.board_lists (project_id, name, sort_order, is_system)
  values
    (new.id, 'Материалы к заказу', 0, true),
    (new.id, 'Напоминания', 1, true),
    (new.id, 'Мероприятия', 2, true);

  return new;
end;
$$;

-- Рабочие дни: пропускает субботу и воскресенье. Используется серверными
-- операциями; основной расчёт для UI — в lib/business/working-days.ts.

create or replace function public.next_working_day(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case extract(isodow from d)::int
    when 5 then d + 3
    when 6 then d + 2
    else d + 1
  end;
$$;
