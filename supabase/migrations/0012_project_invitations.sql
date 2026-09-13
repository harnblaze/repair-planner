-- Приглашения в проект по ссылке и разделение прав на чтение и запись
-- (docs/database.md §5.3, §5.13, §6).
--
-- Роли: owner — всё; member — данные проекта; viewer — только чтение.
-- Настройки проекта, участники и приглашения — только owner.
-- Коды исключений — стабильные строки, их переводит lib/errors.ts.

-- ================= Право на запись =================

-- Как и project_access (0002), читает членство в обход RLS, чтобы политики
-- не уходили в рекурсию.
create or replace function public.project_can_edit(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
      and pm.role in ('owner', 'member')
  )
$$;

revoke all on function public.project_can_edit(uuid) from public, anon;
grant execute on function public.project_can_edit(uuid) to authenticated;

-- ================= Политики записи данных проекта =================

-- SELECT по-прежнему доступен любому участнику (project_access is not null),
-- INSERT/UPDATE/DELETE — только owner и member. Все таблицы используют один
-- шаблон, поэтому политики пересоздаются в цикле.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'executors', 'materials',
    'tasks', 'task_schedule', 'task_executors', 'task_materials',
    'board_lists', 'board_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.project_can_edit(project_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.project_can_edit(project_id))
         with check (public.project_can_edit(project_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.project_can_edit(project_id))',
      t || '_delete', t);
  end loop;
end
$$;

-- Системные списки нельзя удалить (0006) — условие сохраняется.
drop policy if exists "board_lists_delete" on public.board_lists;
create policy "board_lists_delete" on public.board_lists for delete to authenticated
  using (public.project_can_edit(project_id) and not is_system);

-- ================= RPC движения материалов =================

-- Тела из 0010; изменилась только проверка доступа. Без доступа к проекту
-- материал неотличим от несуществующего (material_not_found), участнику
-- без права записи — access_denied.

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

  if not public.project_can_edit(v_project_id) then
    raise exception 'access_denied';
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

  -- Сначала доступ, потом блокировка: без права записи строку материала
  -- заблокировать нельзя даже на время вызова.
  select project_id into v_project_id
  from public.materials
  where id = p_material_id;

  if v_project_id is null or public.project_access(v_project_id) is null then
    raise exception 'material_not_found';
  end if;

  if not public.project_can_edit(v_project_id) then
    raise exception 'access_denied';
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

-- ================= project_members =================

-- Прямой INSERT больше не нужен никому: участник появляется только через
-- триггер создания проекта (owner) и accept_project_invitation. Иначе владелец
-- мог бы добавить в проект произвольный user_id.
drop policy if exists "project_members_insert" on public.project_members;

-- Изменяемая колонка — только role: project_id и user_id подменить нельзя.
revoke update on public.project_members from authenticated;
grant update (role) on public.project_members to authenticated;

-- Владелец меняет роль участника между member и viewer. Роль owner не
-- выдаётся и не отнимается (передача владения — отдельная задача).
drop policy if exists "project_members_update" on public.project_members;
create policy "project_members_update" on public.project_members for update to authenticated
  using (public.project_access(project_id) = 'owner' and role <> 'owner')
  with check (public.project_access(project_id) = 'owner' and role in ('member', 'viewer'));

-- Владелец удаляет участника, участник может выйти сам. Строку владельца
-- удалить нельзя.
drop policy if exists "project_members_delete" on public.project_members;
create policy "project_members_delete" on public.project_members for delete to authenticated
  using (
    role <> 'owner'
    and (public.project_access(project_id) = 'owner' or user_id = (select auth.uid()))
  );

-- ================= Приглашения =================

-- Одноразовая ссылка со сроком действия, не привязанная к email. Хранится
-- только sha256 токена: утечка таблицы не раскрывает действующие ссылки.
create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  role public.project_role not null check (role in ('member', 'viewer')),
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

create index if not exists project_invitations_project_id_idx
  on public.project_invitations (project_id, created_at);

alter table public.project_invitations enable row level security;

-- INSERT/UPDATE политик нет: создание и принятие — только через RPC ниже.
drop policy if exists "project_invitations_select" on public.project_invitations;
create policy "project_invitations_select" on public.project_invitations for select to authenticated
  using (public.project_access(project_id) = 'owner');

-- Отзыв — удаление ещё не принятого приглашения. Принятые остаются историей.
drop policy if exists "project_invitations_delete" on public.project_invitations;
create policy "project_invitations_delete" on public.project_invitations for delete to authenticated
  using (public.project_access(project_id) = 'owner' and accepted_at is null);

-- Хеш токена в одном месте, чтобы создание и поиск не разошлись.
create or replace function private.invitation_token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(p_token, 'sha256')
$$;

revoke all on function private.invitation_token_hash(text) from public, anon, authenticated;

-- Возвращает токен один раз. Токен — 32 случайных байта в base64url (43 символа).
create or replace function public.create_project_invitation(
  p_project_id uuid,
  p_role public.project_role
)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if public.project_access(p_project_id) is distinct from 'owner' then
    raise exception 'access_denied';
  end if;

  if p_role is null or p_role not in ('member', 'viewer') then
    raise exception 'invalid_role';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  return query
    insert into public.project_invitations as i (project_id, role, token_hash, created_by)
    values (p_project_id, p_role, private.invitation_token_hash(v_token), (select auth.uid()))
    returning i.id, v_token, i.expires_at;
end;
$$;

-- Экран принятия. Кто знает токен, тот вправе увидеть название проекта и роль.
-- Неизвестный токен — пустой результат.
create or replace function public.get_project_invitation(p_token text)
returns table (
  project_name text,
  role public.project_role,
  inviter_name text,
  expires_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.name,
    i.role,
    pr.full_name,
    i.expires_at,
    case
      when exists (
        select 1 from public.project_members pm
        where pm.project_id = i.project_id and pm.user_id = (select auth.uid())
      ) then 'already_member'
      when i.accepted_at is not null then 'used'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end
  from public.project_invitations i
  join public.projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.created_by
  where (select auth.uid()) is not null
    and i.token_hash = private.invitation_token_hash(p_token)
    and p.archived_at is null
$$;

-- Принятие. Уже участник — возвращаем проект, не меняя роль и не расходуя
-- приглашение (например, владелец открыл собственную ссылку).
create or replace function public.accept_project_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invitation public.project_invitations;
begin
  if v_user_id is null then
    raise exception 'invitation_not_found';
  end if;

  -- Блокировка строки: одну ссылку не примут одновременно двое.
  select i.* into v_invitation
  from public.project_invitations i
  join public.projects p on p.id = i.project_id
  where i.token_hash = private.invitation_token_hash(p_token)
    and p.archived_at is null
  for update of i;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  if exists (
    select 1 from public.project_members pm
    where pm.project_id = v_invitation.project_id and pm.user_id = v_user_id
  ) then
    return v_invitation.project_id;
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'invitation_used';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation_expired';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invitation.project_id, v_user_id, v_invitation.role);

  update public.project_invitations
    set accepted_at = now(), accepted_by = v_user_id
    where id = v_invitation.id;

  return v_invitation.project_id;
end;
$$;

-- Участники проекта с именами. profiles и auth.users другим пользователям
-- недоступны, поэтому нужна функция. Email видят владелец и сам пользователь.
create or replace function public.project_member_list(p_project_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.project_role,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pm.user_id,
    pr.full_name,
    case
      when public.project_access(p_project_id) = 'owner' or pm.user_id = (select auth.uid())
        then u.email::text
    end,
    pm.role,
    pm.created_at
  from public.project_members pm
  left join public.profiles pr on pr.id = pm.user_id
  left join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and public.project_access(p_project_id) is not null
  order by case pm.role when 'owner' then 0 when 'member' then 1 else 2 end, pm.created_at
$$;

revoke all on function public.create_project_invitation(uuid, public.project_role) from public, anon;
revoke all on function public.get_project_invitation(text) from public, anon;
revoke all on function public.accept_project_invitation(text) from public, anon;
revoke all on function public.project_member_list(uuid) from public, anon;

grant execute on function public.create_project_invitation(uuid, public.project_role) to authenticated;
grant execute on function public.get_project_invitation(text) to authenticated;
grant execute on function public.accept_project_invitation(text) to authenticated;
grant execute on function public.project_member_list(uuid) to authenticated;
