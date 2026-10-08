-- Очереди текущих заявок и ручной порядок в них
-- (docs/superpowers/specs/2026-10-08-task-queues-design.md).
-- Основная очередь «Текущие заявки» — tasks.queue_id is null, строки у неё нет.

-- ================= task_queues =================

create table if not exists public.task_queues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists task_queues_project_idx on public.task_queues (project_id, created_at);

drop trigger if exists task_queues_set_updated_at on public.task_queues;
create trigger task_queues_set_updated_at
  before update on public.task_queues
  for each row execute function public.set_updated_at();

alter table public.task_queues enable row level security;

drop policy if exists "task_queues_select" on public.task_queues;
create policy "task_queues_select" on public.task_queues for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "task_queues_insert" on public.task_queues;
create policy "task_queues_insert" on public.task_queues for insert to authenticated
  with check (public.project_can_edit(project_id));

drop policy if exists "task_queues_update" on public.task_queues;
create policy "task_queues_update" on public.task_queues for update to authenticated
  using (public.project_can_edit(project_id))
  with check (public.project_can_edit(project_id));

drop policy if exists "task_queues_delete" on public.task_queues;
create policy "task_queues_delete" on public.task_queues for delete to authenticated
  using (public.project_can_edit(project_id));

-- project_id неизменяем: право UPDATE только на name. Отозвать право на одну
-- колонку при праве на всю таблицу (Supabase выдаёт его по умолчанию) нельзя.
revoke update on public.task_queues from authenticated, anon;
grant update (name) on public.task_queues to authenticated;

-- ================= tasks: очередь и место в ней =================

alter table public.tasks add column if not exists queue_id uuid;
alter table public.tasks add column if not exists backlog_position int;

comment on column public.tasks.queue_id is
  'Очередь текущих заявок; null — основная («Текущие заявки»)';
comment on column public.tasks.backlog_position is
  'Место в панели очереди (меньше — выше); null — заявка не в панели (запланирована или закрыта)';

-- Составной FK, как у category_id (docs/database.md §4): очередь чужого проекта
-- отвергает сам PostgreSQL. При удалении очереди заявки уходят в основную.
alter table public.tasks drop constraint if exists tasks_queue_fk;
alter table public.tasks
  add constraint tasks_queue_fk
    foreign key (queue_id, project_id) references public.task_queues (id, project_id)
    on delete set null (queue_id);

-- Для каскада при удалении очереди.
create index if not exists tasks_queue_idx on public.tasks (queue_id) where queue_id is not null;

-- Заявка встаёт наверх своей очереди, когда появляется в панели заново: новая,
-- вернулась с доски, очищена дата, переоткрыта, сменила очередь. «Наверх» —
-- позиция на единицу меньше самой верхней в очереди: null с порядком по дате
-- создания поставил бы старую вернувшуюся заявку ниже более новых. Ушедшая из
-- панели (запланирована, закрыта) теряет позицию.
create or replace function private.reset_task_backlog_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.planned_date is not distinct from old.planned_date
     and new.queue_id is not distinct from old.queue_id
     and (new.status in ('completed', 'cancelled')) = (old.status in ('completed', 'cancelled')) then
    return new;
  end if;

  if new.planned_date is not null or new.status in ('completed', 'cancelled') then
    new.backlog_position := null;
  else
    select coalesce(min(t.backlog_position), 0) - 1
      into new.backlog_position
      from public.tasks t
      where t.project_id = new.project_id
        and t.queue_id is not distinct from new.queue_id
        and t.planned_date is null
        and t.status not in ('completed', 'cancelled')
        and t.id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_backlog_position on public.tasks;
create trigger tasks_reset_backlog_position
  before insert or update of planned_date, status, queue_id on public.tasks
  for each row execute function private.reset_task_backlog_position();

-- Заявки, уже лежащие в панелях, получают позиции в прежнем видимом порядке
-- (новые сверху) — выше любых уже расставленных. Повторный запуск ничего не меняет.
with unranked as (
  select t.id,
         (row_number() over w - count(*) over (partition by t.project_id, t.queue_id))::int as pos
    from public.tasks t
    where t.backlog_position is null
      and t.planned_date is null
      and t.status not in ('completed', 'cancelled')
    window w as (partition by t.project_id, t.queue_id order by t.created_at desc, t.id)
)
update public.tasks t
  set backlog_position = unranked.pos
  from unranked
  where t.id = unranked.id;

-- ================= RPC: порядок и перенос между очередями =================

-- p_queue_id — целевая очередь (null — основная); p_position — место в ней без
-- перемещаемой заявки. Образец — move_board_item (0008).
create or replace function public.move_backlog_task(p_task_id uuid, p_queue_id uuid, p_position int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_from_key text;
  v_to_key text;
  v_count int;
  v_position int;
begin
  select t.id, t.project_id, t.status, t.planned_date, t.queue_id
    into v_task
    from public.tasks t
    where t.id = p_task_id;

  if not found then
    raise exception 'task_not_found';
  end if;

  -- Явно: при security invoker UPDATE без права просто изменил бы ноль строк.
  if not public.project_can_edit(v_task.project_id) then
    raise exception 'access_denied';
  end if;

  if v_task.planned_date is not null then
    raise exception 'task_already_planned';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;

  if p_queue_id is not null and not exists (
    select 1 from public.task_queues q
      where q.id = p_queue_id and q.project_id = v_task.project_id
  ) then
    raise exception 'queue_not_found';
  end if;

  -- Обе очереди и в порядке ключей: параллельная перестановка исходной очереди
  -- не запишет позицию ушедшей заявке, встречные переносы не заблокируют друг друга.
  v_from_key := coalesce(v_task.queue_id::text, '');
  v_to_key := coalesce(p_queue_id::text, '');
  perform private.lock_board_container('queue', v_task.project_id, least(v_from_key, v_to_key));
  if v_from_key <> v_to_key then
    perform private.lock_board_container('queue', v_task.project_id, greatest(v_from_key, v_to_key));
    -- Триггер tasks_reset_backlog_position поставит заявку наверх; её место задаёт перенумерация ниже.
    update public.tasks set queue_id = p_queue_id where id = p_task_id;
  end if;

  select count(*) into v_count
    from public.tasks t
    where t.project_id = v_task.project_id
      and t.queue_id is not distinct from p_queue_id
      and t.planned_date is null
      and t.status not in ('completed', 'cancelled')
      and t.id <> p_task_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select t.id,
           (row_number() over (
              order by t.backlog_position asc nulls first, t.created_at desc, t.id
            ) - 1)::int as rn
      from public.tasks t
      where t.project_id = v_task.project_id
        and t.queue_id is not distinct from p_queue_id
        and t.planned_date is null
        and t.status not in ('completed', 'cancelled')
        and t.id <> p_task_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_task_id, v_position
  )
  update public.tasks t
    set backlog_position = target.new_position
    from target
    where t.id = target.id and t.backlog_position is distinct from target.new_position;
end;
$$;

revoke all on function public.move_backlog_task(uuid, uuid, int) from public, anon;
grant execute on function public.move_backlog_task(uuid, uuid, int) to authenticated;
