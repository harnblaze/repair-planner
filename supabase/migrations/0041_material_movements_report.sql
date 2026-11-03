-- Движение материалов за произвольный период (0041).
--
-- Третий отчёт раздела «Отчёты»: сколько материала пришло, сколько ушло и
-- сколько осталось на конец периода. Источник — журнал material_movements,
-- как и в помесячном отчёте (0009).
--
-- Границы периода считаются в timezone проекта, включительно с обеих сторон:
-- p_from — местная полночь, p_to захватывается целиком (верхняя граница —
-- полночь следующего дня, строгое <). Так движение ровно в p_to попадает в отчёт.
--
-- Остаток на конец периода «откатывается» назад от текущего: из
-- materials.current_balance вычитаются все движения позже p_to. Поэтому отчёт
-- за прошлый период не меняется от того, что после него что-то пришло.
--
-- Материалы без движений в периоде тоже попадают в результат (left join):
-- мастеру нужно видеть, что материал не двигался, а не что его нет.
--
-- Функция только читает данные и выполняется с правами вызывающего
-- (security invoker): RLS ограничивает строки проектами, к которым есть доступ,
-- а отсутствие доступа оставляет результат пустым (cross join по projects).

create or replace function public.material_movements_by_period(
  p_project_id uuid,
  p_from date,
  p_to date
)
returns table (
  material_id uuid,
  name text,
  unit text,
  receipt numeric,
  consumption numeric,
  adjustment numeric,
  balance_at_end numeric,
  last_moved_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    -- Нет доступа к проекту — нет строки bounds, и отчёт пуст.
    select
      (p_from::timestamp at time zone p.timezone) as from_at,
      ((p_to + 1)::timestamp at time zone p.timezone) as to_at
    from public.projects p
    where p.id = p_project_id
  ),
  inside as (
    select
      mm.material_id,
      sum(case when mm.kind = 'receipt' then mm.quantity else 0 end) as receipt,
      -- Расход в журнале отрицательный, а мастеру показываем положительное число.
      sum(case when mm.kind = 'consumption' then -mm.quantity else 0 end) as consumption,
      -- Корректировки бывают в обе стороны — знак сохраняем.
      sum(case when mm.kind = 'adjustment' then mm.quantity else 0 end) as adjustment,
      max(mm.occurred_at) as last_moved_at
    from bounds b
    join public.material_movements mm
      on mm.project_id = p_project_id
     and mm.occurred_at >= b.from_at
     and mm.occurred_at < b.to_at
    group by mm.material_id
  ),
  later as (
    -- Всё, что случилось после периода: на эту сумму текущий остаток больше
    -- остатка на конец периода.
    select mm.material_id, sum(mm.quantity) as delta
    from bounds b
    join public.material_movements mm
      on mm.project_id = p_project_id
     and mm.occurred_at >= b.to_at
    group by mm.material_id
  )
  select
    m.id as material_id,
    m.name,
    m.unit,
    coalesce(i.receipt, 0) as receipt,
    coalesce(i.consumption, 0) as consumption,
    coalesce(i.adjustment, 0) as adjustment,
    m.current_balance - coalesce(l.delta, 0) as balance_at_end,
    i.last_moved_at
  from public.materials m
  cross join bounds b
  left join inside i on i.material_id = m.id
  left join later l on l.material_id = m.id
  where m.project_id = p_project_id
  -- Порядок как на экране: сначала то, что больше всего израсходовано.
  order by coalesce(i.consumption, 0) desc, m.name;
$$;

comment on function public.material_movements_by_period(uuid, date, date) is
  'Движение материалов за период (включительно, timezone проекта): приход, расход, остаток на конец и последнее движение.';

revoke all on function public.material_movements_by_period(uuid, date, date) from public, anon;
grant execute on function public.material_movements_by_period(uuid, date, date) to authenticated;
