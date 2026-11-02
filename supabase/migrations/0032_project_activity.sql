-- Лента проекта: журнал значимых изменений (0032, этап A — только база).
--
-- Пишут только триггеры: у таблицы нет INSERT/UPDATE/DELETE политик, а
-- единственный путь записи — private.activity_write (security definer).
-- Так событие нельзя забыть в новом экшене и нельзя подделать с клиента.
--
-- В payload — снимок названия на момент события, а не ссылка: переименование
-- заявки или исполнителя задним числом не переписывает историю.

create table if not exists public.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Автор события. В SQL-импортах auth.uid() пуст, и остаётся null — это честнее,
  -- чем приписать событие владельцу проекта.
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_activity_project_time_idx
  on public.project_activity (project_id, created_at desc);

alter table public.project_activity enable row level security;

-- Читают участники проекта. Политик на запись нет намеренно.
drop policy if exists project_activity_select on public.project_activity;
create policy project_activity_select on public.project_activity
  for select using (public.project_access(project_id) is not null);

-- ── Запись события ────────────────────────────────────────────────────────────

-- Единственная точка записи. security definer нужен по двум причинам: обойти
-- RLS (политики на insert нет) и собрать снимок названий независимо от того,
-- что видит вызывающий.
--
-- exists-проверка проекта защищает каскадное удаление проекта: триггеры на
-- дочерних строках успевают сработать, когда строки projects уже нет, и без
-- неё вставка упала бы на внешнем ключе.
create or replace function private.activity_write(
  p_project_id uuid,
  p_kind text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.project_activity (project_id, actor_id, kind, entity_type, entity_id, payload)
  select p_project_id, (select auth.uid()), p_kind, p_entity_type, p_entity_id,
         coalesce(p_payload, '{}'::jsonb)
  where exists (select 1 from public.projects p where p.id = p_project_id);
$$;

-- ── Заявки ────────────────────────────────────────────────────────────────────

create or replace function private.activity_task_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.activity_write(
    new.project_id, 'task.created', 'task', new.id,
    jsonb_build_object('title', new.title)
  );
  return null;
end;
$$;

drop trigger if exists tasks_activity_created on public.tasks;
create trigger tasks_activity_created
  after insert on public.tasks
  for each row execute function private.activity_task_created();

-- Смена статуса и возврат в «Текущие заявки» — два разных события, но обе
-- ловятся одним триггером: колонки участвуют в одном update.
create or replace function private.activity_task_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform private.activity_write(
      new.project_id, 'task.status', 'task', new.id,
      jsonb_build_object('title', new.title, 'from', old.status::text, 'to', new.status::text)
    );
  end if;

  if old.planned_date is not null and new.planned_date is null then
    perform private.activity_write(
      new.project_id, 'task.returned_to_backlog', 'task', new.id,
      jsonb_build_object('title', new.title)
    );
  end if;

  return null;
end;
$$;

drop trigger if exists tasks_activity_changed on public.tasks;
create trigger tasks_activity_changed
  after update of status, planned_date on public.tasks
  for each row execute function private.activity_task_changed();

-- ── Исполнители заявки ────────────────────────────────────────────────────────

create or replace function private.activity_task_executor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_executor_id uuid;
  v_project_id uuid;
  v_task text;
  v_executor text;
  v_kind text;
begin
  if tg_op = 'DELETE' then
    v_task_id := old.task_id;
    v_executor_id := old.executor_id;
    v_project_id := old.project_id;
    v_kind := 'task.executor.removed';
  else
    v_task_id := new.task_id;
    v_executor_id := new.executor_id;
    v_project_id := new.project_id;
    v_kind := 'task.executor.added';
  end if;

  select t.title into v_task from public.tasks t where t.id = v_task_id;
  select e.name into v_executor from public.executors e where e.id = v_executor_id;

  perform private.activity_write(
    v_project_id, v_kind, 'task', v_task_id,
    jsonb_build_object('task', v_task, 'executor', v_executor)
  );
  return null;
end;
$$;

drop trigger if exists task_executors_activity_added on public.task_executors;
create trigger task_executors_activity_added
  after insert on public.task_executors
  for each row execute function private.activity_task_executor();

drop trigger if exists task_executors_activity_removed on public.task_executors;
create trigger task_executors_activity_removed
  after delete on public.task_executors
  for each row execute function private.activity_task_executor();

-- ── Перенос на следующий день ─────────────────────────────────────────────────

create or replace function private.activity_task_carried_over()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task text;
  v_from date;
begin
  select t.title into v_task from public.tasks t where t.id = new.task_id;

  -- Откуда перенесли — предыдущий день этой заявки, а не today - 1: между ними
  -- могли быть выходные.
  select max(s.work_date) into v_from
    from public.task_schedule s
   where s.task_id = new.task_id and s.work_date < new.work_date;

  perform private.activity_write(
    new.project_id, 'task.carried_over', 'task', new.task_id,
    jsonb_build_object('task', v_task, 'from_date', v_from, 'to_date', new.work_date)
  );
  return null;
end;
$$;

drop trigger if exists task_schedule_activity_carried_over on public.task_schedule;
create trigger task_schedule_activity_carried_over
  after insert on public.task_schedule
  for each row when (new.carried_over)
  execute function private.activity_task_carried_over();

-- ── Пункты дополнительных списков ─────────────────────────────────────────────

create or replace function private.activity_board_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list text;
  v_list_id uuid;
  v_title text;
  v_kind text;
  v_project_id uuid;
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_project_id := old.project_id;
    v_id := old.id;
    v_title := old.title;
    v_list_id := old.list_id;
    v_kind := 'item.deleted';
  else
    v_project_id := new.project_id;
    v_id := new.id;
    v_title := new.title;
    v_list_id := new.list_id;
    if tg_op = 'INSERT' then
      v_kind := 'item.created';
    elsif new.is_done and not old.is_done then
      v_kind := 'item.done';
    elseif not new.is_done and old.is_done then
      v_kind := 'item.reopened';
    else
      return null;
    end if;
  end if;

  select l.name into v_list from public.board_lists l where l.id = v_list_id;

  perform private.activity_write(
    v_project_id, v_kind, 'board_item', v_id,
    jsonb_build_object('title', v_title, 'list', v_list)
  );
  return null;
end;
$$;

drop trigger if exists board_items_activity_created on public.board_items;
create trigger board_items_activity_created
  after insert on public.board_items
  for each row execute function private.activity_board_item();

drop trigger if exists board_items_activity_done on public.board_items;
create trigger board_items_activity_done
  after update of is_done on public.board_items
  for each row when (old.is_done is distinct from new.is_done)
  execute function private.activity_board_item();

drop trigger if exists board_items_activity_deleted on public.board_items;
create trigger board_items_activity_deleted
  after delete on public.board_items
  for each row execute function private.activity_board_item();

-- ── Материалы ─────────────────────────────────────────────────────────────────

create or replace function private.activity_material_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_material text;
  v_unit text;
  v_task text;
  v_payload jsonb;
begin
  select m.name, m.unit into v_material, v_unit from public.materials m where m.id = new.material_id;
  if new.task_id is not null then
    select t.title into v_task from public.tasks t where t.id = new.task_id;
  end if;

  v_payload := jsonb_build_object(
    'material', v_material,
    'unit', v_unit,
    'kind', new.kind::text,
    'quantity', new.quantity
  );
  if v_task is not null then
    v_payload := v_payload || jsonb_build_object('task', v_task);
  end if;

  perform private.activity_write(
    new.project_id, 'material.moved', 'material', new.material_id, v_payload
  );
  return null;
end;
$$;

drop trigger if exists material_movements_activity_moved on public.material_movements;
create trigger material_movements_activity_moved
  after insert on public.material_movements
  for each row execute function private.activity_material_moved();

create or replace function private.activity_material_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'material.created', 'material', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif old.is_active and not new.is_active then
    perform private.activity_write(
      new.project_id, 'material.archived', 'material', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif not old.is_active and new.is_active then
    perform private.activity_write(
      new.project_id, 'material.restored', 'material', new.id,
      jsonb_build_object('name', new.name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists materials_activity_created on public.materials;
create trigger materials_activity_created
  after insert on public.materials
  for each row execute function private.activity_material_lifecycle();

drop trigger if exists materials_activity_lifecycle on public.materials;
create trigger materials_activity_lifecycle
  after update of is_active on public.materials
  for each row when (old.is_active is distinct from new.is_active)
  execute function private.activity_material_lifecycle();

-- ── Справочники: цеха и исполнители ───────────────────────────────────────────

create or replace function private.activity_category_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'category.created', 'category', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif not old.is_archived and new.is_archived then
    perform private.activity_write(
      new.project_id, 'category.archived', 'category', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif old.is_archived and not new.is_archived then
    perform private.activity_write(
      new.project_id, 'category.restored', 'category', new.id,
      jsonb_build_object('name', new.name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists categories_activity_created on public.categories;
create trigger categories_activity_created
  after insert on public.categories
  for each row execute function private.activity_category_lifecycle();

drop trigger if exists categories_activity_lifecycle on public.categories;
create trigger categories_activity_lifecycle
  after update of is_archived on public.categories
  for each row when (old.is_archived is distinct from new.is_archived)
  execute function private.activity_category_lifecycle();

create or replace function private.activity_executor_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'executor.created', 'executor', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif old.is_active and not new.is_active then
    perform private.activity_write(
      new.project_id, 'executor.archived', 'executor', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif not old.is_active and new.is_active then
    perform private.activity_write(
      new.project_id, 'executor.restored', 'executor', new.id,
      jsonb_build_object('name', new.name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists executors_activity_created on public.executors;
create trigger executors_activity_created
  after insert on public.executors
  for each row execute function private.activity_executor_lifecycle();

drop trigger if exists executors_activity_lifecycle on public.executors;
create trigger executors_activity_lifecycle
  after update of is_active on public.executors
  for each row when (old.is_active is distinct from new.is_active)
  execute function private.activity_executor_lifecycle();

-- ── Списки доски ──────────────────────────────────────────────────────────────

create or replace function private.activity_board_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'list.created', 'board_list', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      perform private.activity_write(
        new.project_id, 'list.renamed', 'board_list', new.id,
        jsonb_build_object('name', new.name, 'from', old.name)
      );
    end if;
  else
    perform private.activity_write(
      old.project_id, 'list.deleted', 'board_list', old.id,
      jsonb_build_object('name', old.name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists board_lists_activity_created on public.board_lists;
create trigger board_lists_activity_created
  after insert on public.board_lists
  for each row execute function private.activity_board_list();

drop trigger if exists board_lists_activity_renamed on public.board_lists;
create trigger board_lists_activity_renamed
  after update of name on public.board_lists
  for each row when (old.name is distinct from new.name)
  execute function private.activity_board_list();

drop trigger if exists board_lists_activity_deleted on public.board_lists;
create trigger board_lists_activity_deleted
  after delete on public.board_lists
  for each row execute function private.activity_board_list();

-- ── Очереди заявок ────────────────────────────────────────────────────────────

create or replace function private.activity_task_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'queue.created', 'task_queue', new.id,
      jsonb_build_object('name', new.name)
    );
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      perform private.activity_write(
        new.project_id, 'queue.renamed', 'task_queue', new.id,
        jsonb_build_object('name', new.name, 'from', old.name)
      );
    end if;
  else
    perform private.activity_write(
      old.project_id, 'queue.deleted', 'task_queue', old.id,
      jsonb_build_object('name', old.name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists task_queues_activity_created on public.task_queues;
create trigger task_queues_activity_created
  after insert on public.task_queues
  for each row execute function private.activity_task_queue();

drop trigger if exists task_queues_activity_renamed on public.task_queues;
create trigger task_queues_activity_renamed
  after update of name on public.task_queues
  for each row when (old.name is distinct from new.name)
  execute function private.activity_task_queue();

drop trigger if exists task_queues_activity_deleted on public.task_queues;
create trigger task_queues_activity_deleted
  after delete on public.task_queues
  for each row execute function private.activity_task_queue();

-- ── Календарь проекта ─────────────────────────────────────────────────────────

create or replace function private.activity_calendar_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'calendar.day_added', 'calendar_day', new.id,
      jsonb_build_object('day', new.day, 'kind', new.kind::text)
    );
  else
    perform private.activity_write(
      old.project_id, 'calendar.day_removed', 'calendar_day', old.id,
      jsonb_build_object('day', old.day, 'kind', old.kind::text)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists project_calendar_days_activity_added on public.project_calendar_days;
create trigger project_calendar_days_activity_added
  after insert on public.project_calendar_days
  for each row execute function private.activity_calendar_day();

drop trigger if exists project_calendar_days_activity_removed on public.project_calendar_days;
create trigger project_calendar_days_activity_removed
  after delete on public.project_calendar_days
  for each row execute function private.activity_calendar_day();

-- ── Участники проекта ─────────────────────────────────────────────────────────

create or replace function private.activity_project_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  select p.full_name into v_name from public.profiles p where p.id = v_user_id;

  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'member.joined', 'project_member', v_user_id,
      jsonb_build_object('full_name', v_name, 'role', new.role::text)
    );
  elsif tg_op = 'DELETE' then
    perform private.activity_write(
      old.project_id, 'member.left', 'project_member', v_user_id,
      jsonb_build_object('full_name', v_name, 'role', old.role::text)
    );
  elsif new.role is distinct from old.role then
    perform private.activity_write(
      new.project_id, 'member.role_changed', 'project_member', v_user_id,
      jsonb_build_object('full_name', v_name, 'role', new.role::text, 'from', old.role::text)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists project_members_activity_joined on public.project_members;
create trigger project_members_activity_joined
  after insert on public.project_members
  for each row execute function private.activity_project_member();

drop trigger if exists project_members_activity_role on public.project_members;
create trigger project_members_activity_role
  after update of role on public.project_members
  for each row when (old.role is distinct from new.role)
  execute function private.activity_project_member();

drop trigger if exists project_members_activity_left on public.project_members;
create trigger project_members_activity_left
  after delete on public.project_members
  for each row execute function private.activity_project_member();

-- ── Приглашения ───────────────────────────────────────────────────────────────

create or replace function private.activity_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.activity_write(
      new.project_id, 'invitation.created', 'project_invitation', new.id,
      jsonb_build_object('role', new.role::text)
    );
  else
    perform private.activity_write(
      old.project_id, 'invitation.revoked', 'project_invitation', old.id,
      jsonb_build_object('role', old.role::text)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists project_invitations_activity_created on public.project_invitations;
create trigger project_invitations_activity_created
  after insert on public.project_invitations
  for each row execute function private.activity_invitation();

drop trigger if exists project_invitations_activity_revoked on public.project_invitations;
create trigger project_invitations_activity_revoked
  after delete on public.project_invitations
  for each row execute function private.activity_invitation();

-- ── Чистка старше 6 месяцев ───────────────────────────────────────────────────

create or replace function public.purge_project_activity(p_keep interval default '6 months')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.project_activity
   where created_at < now() - p_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Стирание истории — не пользовательская операция: иначе любой участник мог бы
-- вычистить журнал всего проекта. Зовут планировщик (postgres) и service_role.
revoke all on function public.purge_project_activity(interval) from public, anon, authenticated;
grant execute on function public.purge_project_activity(interval) to service_role;

-- Планировщик. pg_cron есть не везде: на локальной базе расширения может не
-- быть, на проде оно включается отдельно. Отсутствие расширения или прав не
-- должно ронять миграцию — журнал в этом случае чистится руками вызовом
-- public.purge_project_activity().
do $$
begin
  create extension if not exists pg_cron;

  if not exists (select 1 from cron.job where jobname = 'purge-project-activity') then
    perform cron.schedule(
      'purge-project-activity',
      '30 3 * * *',
      'select public.purge_project_activity();'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron недоступен (%), чистка журнала — вручную: select public.purge_project_activity();', sqlerrm;
end;
$$;
