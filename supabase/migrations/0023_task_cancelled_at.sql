-- Дата отмены заявки: отменённые попадают в фильтр периода архива наравне с
-- выполненными (completed_at). Выставляется вместе со статусом в
-- setTaskStatusAction; согласованность статуса и даты держит CHECK, как у completed_at.

alter table public.tasks add column if not exists cancelled_at timestamptz;

-- Уже отменённые: точной даты отмены нет, ближайшее приближение — последнее
-- изменение заявки. Триггер updated_at отключён, чтобы не затереть его now().
alter table public.tasks disable trigger tasks_set_updated_at;

update public.tasks
  set cancelled_at = updated_at
  where status = 'cancelled' and cancelled_at is null;

alter table public.tasks enable trigger tasks_set_updated_at;

do $$
begin
  if not exists (
    select 1 from pg_constraint
      where conname = 'tasks_cancelled_at_matches_status' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_cancelled_at_matches_status
      check ((status = 'cancelled') = (cancelled_at is not null));
  end if;
end;
$$;

-- В результате появляется cancelled_at — тип результата меняется, поэтому drop + create.
drop function if exists public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int);

-- Архив: период и сортировка — по дате закрытия (выполнения или отмены).
-- security invoker: RLS tasks/categories/executors/task_executors действует —
-- чужой проект даёт пустой результат.
create function public.search_archive_tasks(
  p_project_id uuid,
  p_status text,
  p_query text default null,
  p_category_id uuid default null,
  p_executor_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 50
)
returns table (
  id uuid,
  title text,
  status public.task_status,
  completed_at timestamptz,
  cancelled_at timestamptz,
  category_name text,
  executor_names text[]
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_timezone text;
begin
  if p_status is null or p_status not in ('completed', 'cancelled', 'all') then
    raise exception 'invalid_filter';
  end if;

  select p.timezone into v_timezone from public.projects p where p.id = p_project_id;
  if not found then
    return;
  end if;

  if v_query is not null then
    -- Текст ищется буквально: экранируем спецсимволы LIKE (escape по умолчанию — «\»).
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    t.id,
    t.title,
    t.status,
    t.completed_at,
    t.cancelled_at,
    c.name,
    array(
      select e.name
        from public.task_executors te
        join public.executors e on e.id = te.executor_id
        where te.task_id = t.id
        order by e.name
    )
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.project_id = p_project_id
    and case
          when p_status = 'all' then t.status in ('completed', 'cancelled')
          else t.status = p_status::public.task_status
        end
    and (v_pattern is null or t.title ilike v_pattern or coalesce(t.description, '') ilike v_pattern)
    and (p_category_id is null or t.category_id = p_category_id)
    and (p_executor_id is null or exists (
      select 1 from public.task_executors te2
        where te2.task_id = t.id and te2.executor_id = p_executor_id
    ))
    -- Дата закрытия есть у каждой архивной заявки (CHECK на completed_at и cancelled_at).
    and (p_from is null or coalesce(t.completed_at, t.cancelled_at) >= (p_from::timestamp at time zone v_timezone))
    and (p_to is null or coalesce(t.completed_at, t.cancelled_at) < ((p_to + 1)::timestamp at time zone v_timezone))
  order by coalesce(t.completed_at, t.cancelled_at) desc, t.id
  limit least(greatest(coalesce(p_limit, 1), 1), 1001);
end;
$$;

revoke all on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int) from public, anon;
grant execute on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int) to authenticated;
