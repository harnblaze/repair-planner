-- Приход материала и корректировка остатка по фактическому пересчёту
-- (docs/database.md §7.1, docs/product-requirements.md §4.5).
--
-- Коды исключений — стабильные строки в стиле 0008, приложение переводит их
-- в понятные сообщения (lib/errors.ts). Отсутствие материала и отсутствие
-- доступа к его проекту дают одинаковый код material_not_found, чтобы нельзя
-- было узнать, существует ли чужой материал.

-- Усиление RPC из 0005: сигнатура прежняя, приход должен быть положительным.

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

  if p_quantity is null or p_quantity = 0 or (p_kind = 'receipt' and p_quantity < 0) then
    raise exception 'invalid_quantity';
  end if;

  select project_id into v_project_id
  from public.materials
  where id = p_material_id;

  if v_project_id is null or public.project_access(v_project_id) is null then
    raise exception 'material_not_found';
  end if;

  perform set_config('repair_planner.balance_update', 'on', true);

  update public.materials
    set current_balance = current_balance + p_quantity
    where id = p_material_id;

  insert into public.material_movements
    (project_id, material_id, kind, quantity, note, created_by)
  values
    (v_project_id, p_material_id, p_kind, p_quantity, nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.record_material_movement(uuid, public.movement_kind, numeric, text) from public, anon;
grant execute on function public.record_material_movement(uuid, public.movement_kind, numeric, text) to authenticated;

-- Корректировка по пересчёту: мастер вводит фактический остаток, разницу
-- считает база. Строка материала блокируется до вычисления разницы, поэтому
-- одновременное списание из заявки либо уже учтено в current_balance,
-- либо дождётся конца этой транзакции — изменение не теряется (§7.2).

create or replace function public.set_material_balance(
  p_material_id uuid,
  p_actual_balance numeric,
  p_note text default null
)
returns public.material_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_current_balance numeric(14, 3);
  v_delta numeric(14, 3);
  v_movement public.material_movements;
begin
  if p_actual_balance is null or p_actual_balance < 0 then
    raise exception 'invalid_quantity';
  end if;

  -- Сначала доступ, потом блокировка: без доступа к проекту чужую строку
  -- заблокировать нельзя даже на время вызова.
  select project_id into v_project_id
  from public.materials
  where id = p_material_id;

  if v_project_id is null or public.project_access(v_project_id) is null then
    raise exception 'material_not_found';
  end if;

  select current_balance into v_current_balance
  from public.materials
  where id = p_material_id
  for update;

  if not found then
    raise exception 'material_not_found';
  end if;

  v_delta := p_actual_balance - v_current_balance;

  if v_delta = 0 then
    raise exception 'balance_unchanged';
  end if;

  perform set_config('repair_planner.balance_update', 'on', true);

  update public.materials
    set current_balance = current_balance + v_delta
    where id = p_material_id;

  insert into public.material_movements
    (project_id, material_id, kind, quantity, note, created_by)
  values
    (v_project_id, p_material_id, 'adjustment', v_delta, nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.set_material_balance(uuid, numeric, text) from public, anon;
grant execute on function public.set_material_balance(uuid, numeric, text) to authenticated;
