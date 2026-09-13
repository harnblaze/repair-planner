-- Месячный отчёт по расходу материалов в разрезе цехов-заказчиков
-- (docs/product-requirements.md §4.6, docs/database.md §7.5).
--
-- Источник — неизменяемый журнал material_movements, а не текущие строки
-- task_materials: месяц определяется датой записи движения в timezone проекта,
-- поэтому закрытый месяц не меняется от поздних правок расхода — правка
-- попадает в месяц, когда её внесли.
--
-- Расход = −сумма движений, связанных с заявкой (consumption и adjustment
-- от правок строк расхода). Приход и ручные корректировки без заявки в расход
-- не входят. Цех — текущая категория заявки (снимок категории не хранится).
--
-- Функция только читает данные и выполняется с правами вызывающего
-- (security invoker): RLS ограничивает строки проектами, к которым есть доступ.

create or replace function public.material_consumption_by_category(
  p_project_id uuid,
  p_month date
)
returns table (
  category_id uuid,
  category_name text,
  material_id uuid,
  material_name text,
  unit text,
  quantity numeric
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    -- Границы месяца в timezone проекта. Нет доступа к проекту — нет строки,
    -- и отчёт пуст.
    select
      (date_trunc('month', p_month)::timestamp at time zone p.timezone) as from_at,
      ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone p.timezone) as to_at
    from public.projects p
    where p.id = p_project_id
  )
  select
    c.id as category_id,
    c.name as category_name,
    m.id as material_id,
    m.name as material_name,
    m.unit,
    -sum(mm.quantity) as quantity
  from bounds b
  join public.material_movements mm
    on mm.project_id = p_project_id
   and mm.occurred_at >= b.from_at
   and mm.occurred_at < b.to_at
  join public.tasks t on t.id = mm.task_id
  join public.materials m on m.id = mm.material_id
  left join public.categories c on c.id = t.category_id
  where mm.task_id is not null
    and mm.kind in ('consumption', 'adjustment')
  group by c.id, c.name, m.id, m.name, m.unit
  having sum(mm.quantity) <> 0
  order by c.name nulls last, m.name;
$$;

revoke all on function public.material_consumption_by_category(uuid, date) from public, anon;
grant execute on function public.material_consumption_by_category(uuid, date) to authenticated;
