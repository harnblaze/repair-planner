-- Поиск по материалу в архиве: только заявки, где выбранный материал тратился,
-- и его расход в строке (material_quantity). Новый параметр p_material_id —
-- последний и со значением по умолчанию: вызовы прежнего кода (без него) работают.

-- Меняются аргументы и тип результата — drop + create.
drop function if exists public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int);

-- Архив: период и сортировка — по дате закрытия (выполнения или отмены).
-- security invoker: RLS tasks/categories/executors/task_executors/task_materials
-- действует — чужой проект или материал дают пустой результат.
create or replace function public.search_archive_tasks(
  p_project_id uuid,
  p_status text,
  p_query text default null,
  p_category_id uuid default null,
  p_executor_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 50,
  p_material_id uuid default null
)
returns table (
  id uuid,
  title text,
  status public.task_status,
  completed_at timestamptz,
  cancelled_at timestamptz,
  category_name text,
  executor_names text[],
  material_quantity numeric
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
    ),
    -- Расход выбранного материала; (task_id, material_id) уникальны — одно число.
    case when p_material_id is not null then (
      select tm.quantity from public.task_materials tm
        where tm.task_id = t.id and tm.material_id = p_material_id
    ) end
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
    and (p_material_id is null or exists (
      select 1 from public.task_materials tm2
        where tm2.task_id = t.id and tm2.material_id = p_material_id
    ))
    -- Дата закрытия есть у каждой архивной заявки (CHECK на completed_at и cancelled_at).
    and (p_from is null or coalesce(t.completed_at, t.cancelled_at) >= (p_from::timestamp at time zone v_timezone))
    and (p_to is null or coalesce(t.completed_at, t.cancelled_at) < ((p_to + 1)::timestamp at time zone v_timezone))
  order by coalesce(t.completed_at, t.cancelled_at) desc, t.id
  limit least(greatest(coalesce(p_limit, 1), 1), 1001);
end;
$$;

revoke all on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int, uuid) from public, anon;
grant execute on function public.search_archive_tasks(uuid, text, text, uuid, uuid, date, date, int, uuid) to authenticated;
