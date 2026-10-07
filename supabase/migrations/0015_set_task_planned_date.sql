-- Дата плана в карточке задачи (docs/database.md §5.8).
--
-- Раньше Server Action заменял план задачи несколькими независимыми запросами:
-- удаление расписания, подсчёт позиции, вставка нового дня, смена статуса.
-- Сбой вставки оставлял задачу без плана, а конкурентные вставки в один день
-- могли получить одинаковую позицию. Теперь всё выполняется одной транзакцией.
-- Функция — security invoker: доступ проверяет RLS (viewer не может заблокировать
-- задачу на изменение и получает task_not_found).
-- Коды исключений — стабильные строки, их переводит lib/errors.ts.

-- Ручной выбор даты в карточке:
-- - p_work_date is null — снимает весь план задачи (статус не меняется);
-- - задача не запланирована — планирует как перетаскивание из «Текущих заявок»
--   (plan_task_on_day: история отложенной задачи сохраняется);
-- - задача запланирована — заменяет весь план одним днём в конце этого дня.
--   Это не перенос: история переносов не сохраняется (carry_over_task — отдельное действие).
-- Статус new переводится в planned.
create or replace function public.set_task_planned_date(
  p_project_id uuid,
  p_task_id uuid,
  p_work_date date default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_schedule_id uuid;
begin
  select t.id, t.project_id, t.status, t.planned_date
    into v_task
    from public.tasks t
    where t.id = p_task_id and t.project_id = p_project_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;

  if p_work_date is null then
    delete from public.task_schedule where task_id = p_task_id;
    return;
  end if;

  if v_task.planned_date is null then
    perform public.plan_task_on_day(p_task_id, p_work_date, null);
    return;
  end if;

  if not private.is_working_day(v_task.project_id, p_work_date) then
    raise exception 'not_working_day';
  end if;

  perform private.lock_board_container('day', v_task.project_id, p_work_date::text);

  delete from public.task_schedule where task_id = p_task_id;

  insert into public.task_schedule (project_id, task_id, work_date, created_by)
    values (v_task.project_id, p_task_id, p_work_date, (select auth.uid()))
    returning id into v_schedule_id;

  perform private.place_task_in_day(v_task.project_id, p_work_date, v_schedule_id, null);

  if v_task.status = 'new' then
    update public.tasks set status = 'planned' where id = p_task_id;
  end if;
end;
$$;

revoke all on function public.set_task_planned_date(uuid, uuid, date) from public, anon;
grant execute on function public.set_task_planned_date(uuid, uuid, date) to authenticated;
