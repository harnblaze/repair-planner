-- Отчёт «Выполненные работы за месяц» (docs/superpowers/specs/2026-10-08-completed-works-report-design.md).
-- Выполненные заявки календарного месяца в timezone проекта с исполнителями и
-- материалами (итог расхода по заявке). security invoker: RLS tasks, categories,
-- task_executors, executors, task_materials, materials действует — нет доступа
-- к проекту, нет строки projects и границ месяца, отчёт пуст.

create or replace function public.completed_works_report(
  p_project_id uuid,
  p_month date
)
returns table (
  task_id uuid,
  title text,
  completed_at timestamptz,
  category_id uuid,
  category_name text,
  category_sort_order int,
  executor_names text[],
  materials jsonb
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('month', p_month)::timestamp at time zone p.timezone) as from_at,
      ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone p.timezone) as to_at
    from public.projects p
    where p.id = p_project_id
  )
  select
    t.id,
    t.title,
    t.completed_at,
    c.id,
    c.name,
    c.sort_order,
    array(
      select e.name
        from public.task_executors te
        join public.executors e on e.id = te.executor_id
        where te.task_id = t.id
        order by e.name
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'unit', m.unit, 'quantity', tm.quantity) order by m.name)
        from public.task_materials tm
        join public.materials m on m.id = tm.material_id
        where tm.task_id = t.id
    ), '[]'::jsonb)
  from bounds b
  join public.tasks t
    on t.project_id = p_project_id
   and t.status = 'completed'
   and t.completed_at >= b.from_at
   and t.completed_at < b.to_at
  left join public.categories c on c.id = t.category_id
  order by c.sort_order nulls last, c.name nulls last, t.completed_at, t.id;
$$;

revoke all on function public.completed_works_report(uuid, date) from public, anon;
grant execute on function public.completed_works_report(uuid, date) to authenticated;
