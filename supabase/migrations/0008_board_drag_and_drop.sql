-- Drag-and-drop на доске (docs/architecture.md §7, docs/database.md §5.8, §7.3).
--
-- 1. task_schedule.postponed — «после этого дня задача была отложена»: задачу
--    вернули в «Текущие заявки», но дни, в которые над ней работали, остаются
--    историей. Задача не копируется — идентичность сохраняется (CLAUDE.md §27).
-- 2. Атомарные RPC перемещения. Все RPC — security invoker: доступ проверяется
--    теми же RLS-политиками, что и прямые запросы клиента. Сообщения исключений —
--    стабильные коды, их переводит lib/errors.ts::mapBoardMoveError; пользователю
--    они не показываются.

alter table public.task_schedule
  add column if not exists postponed boolean not null default false;

comment on column public.task_schedule.postponed is
  'true — после этого дня задача была отложена (возвращена в «Текущие заявки»)';

-- ================= planned_date с учётом отложенных задач =================

-- planned_date = work_date последнего дня расписания, но null, если этот день
-- помечен как отложенный: задача снова в «Текущих заявках», а запрос панели
-- (planned_date is null) не меняется. tasks обновляется только при фактическом
-- изменении — иначе перестановка карточек трогала бы updated_at задач.

create or replace function public.recalc_task_planned_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_planned date;
begin
  select case when s.postponed then null else s.work_date end
    into v_planned
    from public.task_schedule s
    where s.task_id = v_task_id
    order by s.work_date desc
    limit 1;

  perform set_config('repair_planner.planned_date_update', 'on', true);

  update public.tasks
    set planned_date = v_planned
    where id = v_task_id
      and planned_date is distinct from v_planned;

  return null;
end;
$$;

-- Смена одной лишь position на planned_date не влияет — триггер на неё не срабатывает.
drop trigger if exists task_schedule_recalc_planned_date on public.task_schedule;
create trigger task_schedule_recalc_planned_date
  after insert or delete or update of work_date, postponed, task_id on public.task_schedule
  for each row execute function public.recalc_task_planned_date();

-- ================= Служебные функции (схема private не публикуется через API) =================

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Сериализует конкурентные перестановки одного списка (дня или board_list).
-- Строк дня может ещё не быть, поэтому блокировка строк (FOR UPDATE) не подходит.
create or replace function private.lock_board_container(p_kind text, p_project_id uuid, p_key text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended(p_kind || ':' || p_project_id::text || ':' || p_key, 0)
  );
$$;

-- Ставит строку расписания на позицию p_position среди остальных задач дня
-- (null — в конец) и перенумеровывает день 0..n-1. RLS действует: функция
-- выполняется с правами вызывающего.
create or replace function private.place_task_in_day(
  p_project_id uuid,
  p_work_date date,
  p_schedule_id uuid,
  p_position int
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_position int;
begin
  select count(*) into v_count
    from public.task_schedule
    where project_id = p_project_id and work_date = p_work_date and id <> p_schedule_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select s.id, (row_number() over (order by s.position, s.created_at, s.id) - 1)::int as rn
      from public.task_schedule s
      where s.project_id = p_project_id and s.work_date = p_work_date and s.id <> p_schedule_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_schedule_id, v_position
  )
  update public.task_schedule s
    set position = t.new_position
    from target t
    where s.id = t.id and s.position is distinct from t.new_position;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.lock_board_container(text, uuid, text) to authenticated;
grant execute on function private.place_task_in_day(uuid, date, uuid, int) to authenticated;

-- ================= RPC: из «Текущих заявок» в день =================

-- Добавляет день в расписание задачи, которая сейчас не запланирована.
-- Если у задачи есть история (она была отложена), история сохраняется, а новый
-- день должен быть не раньше последнего дня истории; тот же день — просто
-- снимает отметку «отложена». Статус new переводится в planned.
create or replace function public.plan_task_on_day(
  p_task_id uuid,
  p_work_date date,
  p_position int default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_last record;
  v_has_history boolean;
  v_schedule_id uuid;
begin
  if p_work_date is null or extract(isodow from p_work_date) > 5 then
    raise exception 'not_working_day';
  end if;

  select t.id, t.project_id, t.status, t.planned_date
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;
  if v_task.planned_date is not null then
    raise exception 'task_already_planned';
  end if;

  perform private.lock_board_container('day', v_task.project_id, p_work_date::text);

  select s.id, s.work_date
    into v_last
    from public.task_schedule s
    where s.task_id = p_task_id
    order by s.work_date desc
    limit 1;

  v_has_history := found;

  if v_has_history and p_work_date < v_last.work_date then
    raise exception 'date_before_history';
  end if;

  if v_has_history and p_work_date = v_last.work_date then
    update public.task_schedule set postponed = false where id = v_last.id;
    v_schedule_id := v_last.id;
  else
    insert into public.task_schedule (project_id, task_id, work_date, carried_over, created_by)
      values (v_task.project_id, p_task_id, p_work_date, v_has_history, (select auth.uid()))
      returning id into v_schedule_id;
  end if;

  perform private.place_task_in_day(v_task.project_id, p_work_date, v_schedule_id, p_position);

  if v_task.status = 'new' then
    update public.tasks set status = 'planned' where id = p_task_id;
  end if;
end;
$$;

-- ================= RPC: порядок внутри дня и смена дня =================

-- p_from_date = p_to_date — только порядок (любая карточка, включая исторические).
-- Смена дня — только для задачи с единственным днём расписания, который не
-- помечен как отложенный: у перенесённых задач дни — история (решение этапа DnD).
create or replace function public.move_task_schedule(
  p_task_id uuid,
  p_from_date date,
  p_to_date date,
  p_position int
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_row record;
begin
  if p_to_date is null or extract(isodow from p_to_date) > 5 then
    raise exception 'not_working_day';
  end if;

  select t.id, t.project_id
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;

  select s.id, s.postponed
    into v_row
    from public.task_schedule s
    where s.task_id = p_task_id and s.work_date = p_from_date;

  if not found then
    raise exception 'schedule_not_found';
  end if;

  -- Блокировки берутся в порядке дат, чтобы встречные перемещения не взаимоблокировались.
  perform private.lock_board_container('day', v_task.project_id, least(p_from_date, p_to_date)::text);
  if p_from_date <> p_to_date then
    perform private.lock_board_container('day', v_task.project_id, greatest(p_from_date, p_to_date)::text);

    if v_row.postponed
       or (select count(*) from public.task_schedule where task_id = p_task_id) > 1 then
      raise exception 'task_has_history';
    end if;

    update public.task_schedule set work_date = p_to_date where id = v_row.id;
  end if;

  perform private.place_task_in_day(v_task.project_id, p_to_date, v_row.id, p_position);
end;
$$;

-- ================= RPC: из дня обратно в «Текущие заявки» =================

-- Правило (решение этапа DnD, docs/product-requirements.md §4.4):
-- * new / planned — работа не начиналась: все дни — только план, удаляются;
-- * in_progress / paused — дни до «сегодня» включительно (в timezone проекта)
--   остаются историей, последний помечается postponed; будущие дни удаляются;
-- * completed / cancelled — запрещено.
-- Возвращает true, если история сохранена.
create or replace function public.return_task_to_backlog(p_task_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_today date;
  v_last_id uuid;
begin
  select t.id, t.status, t.planned_date, p.timezone
    into v_task
    from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id
    for update of t;

  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;
  if v_task.planned_date is null then
    raise exception 'task_not_planned';
  end if;

  v_today := (now() at time zone v_task.timezone)::date;

  if v_task.status in ('new', 'planned') then
    delete from public.task_schedule where task_id = p_task_id;
    return false;
  end if;

  delete from public.task_schedule where task_id = p_task_id and work_date > v_today;

  select s.id into v_last_id
    from public.task_schedule s
    where s.task_id = p_task_id
    order by s.work_date desc
    limit 1;

  if v_last_id is null then
    return false;
  end if;

  update public.task_schedule set postponed = true where id = v_last_id;
  return true;
end;
$$;

-- ================= RPC: порядок в дополнительных списках =================

create or replace function public.move_board_item(p_item_id uuid, p_position int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
  v_count int;
  v_position int;
begin
  select i.id, i.project_id, i.list_id
    into v_item
    from public.board_items i
    where i.id = p_item_id;

  if not found then
    raise exception 'item_not_found';
  end if;

  perform private.lock_board_container('list', v_item.project_id, v_item.list_id::text);

  select count(*) into v_count
    from public.board_items
    where list_id = v_item.list_id and id <> p_item_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select i.id, (row_number() over (order by i.position, i.created_at, i.id) - 1)::int as rn
      from public.board_items i
      where i.list_id = v_item.list_id and i.id <> p_item_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_item_id, v_position
  )
  update public.board_items i
    set position = t.new_position
    from target t
    where i.id = t.id and i.position is distinct from t.new_position;
end;
$$;

revoke all on function public.plan_task_on_day(uuid, date, int) from public, anon;
revoke all on function public.move_task_schedule(uuid, date, date, int) from public, anon;
revoke all on function public.return_task_to_backlog(uuid) from public, anon;
revoke all on function public.move_board_item(uuid, int) from public, anon;

grant execute on function public.plan_task_on_day(uuid, date, int) to authenticated;
grant execute on function public.move_task_schedule(uuid, date, date, int) to authenticated;
grant execute on function public.return_task_to_backlog(uuid) to authenticated;
grant execute on function public.move_board_item(uuid, int) to authenticated;
