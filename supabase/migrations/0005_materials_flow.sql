-- Фактический расход материалов, неизменяемый журнал движений,
-- атомарное изменение остатка через триггер SECURITY DEFINER.

create table if not exists public.task_materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid not null,
  material_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (task_id, material_id),
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  foreign key (material_id, project_id) references public.materials (id, project_id) on delete restrict
);

create index if not exists task_materials_material_idx on public.task_materials (material_id);

drop trigger if exists task_materials_set_updated_at on public.task_materials;
create trigger task_materials_set_updated_at
  before update on public.task_materials
  for each row execute function public.set_updated_at();

alter table public.task_materials enable row level security;

drop policy if exists "task_materials_select" on public.task_materials;
create policy "task_materials_select" on public.task_materials for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "task_materials_insert" on public.task_materials;
create policy "task_materials_insert" on public.task_materials for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_materials_update" on public.task_materials;
create policy "task_materials_update" on public.task_materials for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_materials_delete" on public.task_materials;
create policy "task_materials_delete" on public.task_materials for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Неизменяемый журнал движений материалов. Отрицательный current_balance разрешён
-- осознанно (см. docs/database.md §7.3) — здесь только структура, не бизнес-правило.

create table if not exists public.material_movements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  material_id uuid not null,
  kind public.movement_kind not null,
  quantity numeric(14, 3) not null check (quantity <> 0),
  task_id uuid,
  task_material_id uuid,
  note text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (kind <> 'consumption' or task_id is not null),
  foreign key (material_id, project_id) references public.materials (id, project_id) on delete restrict,
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete restrict,
  foreign key (task_material_id, project_id) references public.task_materials (id, project_id) on delete set null (task_material_id)
);

create index if not exists material_movements_project_occurred_idx on public.material_movements (project_id, occurred_at);
create index if not exists material_movements_material_occurred_idx on public.material_movements (material_id, occurred_at);
create index if not exists material_movements_task_idx on public.material_movements (task_id);

alter table public.material_movements enable row level security;

-- Только SELECT. INSERT/UPDATE/DELETE не имеют policy вовсе: изменения возможны
-- только через SECURITY DEFINER функции ниже (владелец таблицы обходит RLS).

drop policy if exists "material_movements_select" on public.material_movements;
create policy "material_movements_select" on public.material_movements for select to authenticated
  using (public.project_access(project_id) is not null);

-- Атомарность: изменение строки расхода пересчитывает остаток и пишет журнал
-- в одной транзакции, инициированной клиентским INSERT/UPDATE/DELETE.

create or replace function public.apply_task_material_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 3);
  v_kind public.movement_kind;
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_material_id uuid := coalesce(new.material_id, old.material_id);
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_task_material_id uuid := coalesce(new.id, old.id);
  v_created_by uuid := coalesce(new.created_by, old.created_by);
begin
  if tg_op = 'INSERT' then
    v_delta := -new.quantity;
    v_kind := 'consumption';
  elsif tg_op = 'UPDATE' then
    v_delta := -(new.quantity - old.quantity);
    v_kind := 'adjustment';
  else
    -- DELETE: строка task_materials уже удалена, ссылаться на неё нельзя.
    v_delta := old.quantity;
    v_kind := 'adjustment';
    v_task_material_id := null;
  end if;

  if v_delta <> 0 then
    perform set_config('repair_planner.balance_update', 'on', true);

    update public.materials
      set current_balance = current_balance + v_delta
      where id = v_material_id;

    insert into public.material_movements
      (project_id, material_id, kind, quantity, task_id, task_material_id, created_by)
    values
      (v_project_id, v_material_id, v_kind, v_delta, v_task_id, v_task_material_id, v_created_by);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists task_materials_apply_change on public.task_materials;
create trigger task_materials_apply_change
  after insert or update or delete on public.task_materials
  for each row execute function public.apply_task_material_change();

-- RPC для ручного прихода и корректировки остатка (UI появится позже).
-- Списание (consumption) через эту функцию запрещено — оно идёт только
-- через task_materials, где обязательна связь с задачей.

create or replace function public.record_material_movement(
  p_material_id uuid,
  p_kind public.movement_kind,
  p_quantity numeric,
  p_note text default null
)
returns public.material_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_movement public.material_movements;
begin
  if p_kind = 'consumption' then
    raise exception 'consumption movements must be recorded through task_materials';
  end if;

  if p_quantity = 0 then
    raise exception 'quantity must not be zero';
  end if;

  select project_id into v_project_id
  from public.materials
  where id = p_material_id;

  if v_project_id is null then
    raise exception 'material not found';
  end if;

  if public.project_access(v_project_id) is null then
    raise exception 'access denied';
  end if;

  perform set_config('repair_planner.balance_update', 'on', true);

  update public.materials
    set current_balance = current_balance + p_quantity
    where id = p_material_id;

  insert into public.material_movements
    (project_id, material_id, kind, quantity, note, created_by)
  values
    (v_project_id, p_material_id, p_kind, p_quantity, p_note, (select auth.uid()))
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.record_material_movement(uuid, public.movement_kind, numeric, text) from public;
grant execute on function public.record_material_movement(uuid, public.movement_kind, numeric, text) to authenticated;
