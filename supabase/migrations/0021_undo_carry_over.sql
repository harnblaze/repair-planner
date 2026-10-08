-- Отмена переноса на следующий рабочий день (docs/product-requirements.md §2).
--
-- Перенос (carry_over_task, 0013) добавляет заявке новый день расписания с
-- carried_over = true. Отмена удаляет этот последний день — предыдущий снова
-- становится последним, planned_date пересчитывает триггер (0004).
--
-- Отменить можно, только если:
--   * заявка открыта;
--   * последний день появился переносом: carried_over и перед ним есть день,
--     который не отложен (иначе это повторное планирование после «Текущих заявок»);
--   * последний день — сегодня или позже в timezone проекта: прошедший день —
--     история работы, её не удаляем.
--
-- security invoker: `for update` на tasks требует UPDATE-политику (project_can_edit),
-- поэтому viewer и чужие проекты получают task_not_found.

create or replace function public.undo_carry_over(p_task_id uuid)
returns date
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_last record;
  v_prev record;
begin
  select t.id, t.project_id, t.status, p.timezone
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

  select s.id, s.work_date, s.carried_over, s.postponed
    into v_last
    from public.task_schedule s
    where s.task_id = p_task_id
    order by s.work_date desc
    limit 1;

  if not found or not v_last.carried_over or v_last.postponed then
    raise exception 'nothing_to_undo';
  end if;

  select s.work_date, s.postponed
    into v_prev
    from public.task_schedule s
    where s.task_id = p_task_id
      and s.work_date < v_last.work_date
    order by s.work_date desc
    limit 1;

  if not found or v_prev.postponed then
    raise exception 'nothing_to_undo';
  end if;

  if v_last.work_date < (now() at time zone v_task.timezone)::date then
    raise exception 'carry_over_too_old';
  end if;

  perform private.lock_board_container('day', v_task.project_id, v_last.work_date::text);

  delete from public.task_schedule where id = v_last.id;

  return v_prev.work_date;
end;
$$;

revoke all on function public.undo_carry_over(uuid) from public, anon;
grant execute on function public.undo_carry_over(uuid) to authenticated;
