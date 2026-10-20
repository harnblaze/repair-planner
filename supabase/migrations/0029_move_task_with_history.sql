-- Смена дня для задачи с историей (docs/product-requirements.md §4.4, 2026-10-20).
--
-- Раньше move_task_schedule меняла день только у задачи с единственным днём
-- расписания: перенесённую или отложенную и продолженную задачу нельзя было
-- перетащить, в т.ч. обратно на день, когда её отложили.
--
-- Теперь текущий день задачи (последний, не отложенный) можно перенести:
--   * на любой рабочий день позже последнего дня истории — строка сохраняет
--     carried_over, история остаётся как была;
--   * на сам последний день истории — слияние: текущая строка удаляется,
--     с дня истории снимается postponed, он снова становится текущим. Только
--     если текущий день — сегодня или позже в timezone проекта (как в
--     undo_carry_over, 0021): прошедший день — история работы (day_already_passed);
--   * раньше последнего дня истории — нельзя (date_before_history).
-- Дни истории между днями по-прежнему не перетаскиваются (task_has_history).
--
-- security invoker, как в 0008/0013: `for update` на tasks и запись в
-- task_schedule проходят через RLS (project_can_edit).

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
  v_prev record;
  v_target_id uuid;
begin
  if p_to_date is null then
    raise exception 'not_working_day';
  end if;

  select t.id, t.project_id, t.planned_date, p.timezone
    into v_task
    from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id
    for update of t;

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

  v_target_id := v_row.id;

  -- Блокировки берутся в порядке дат, чтобы встречные перемещения не взаимоблокировались.
  perform private.lock_board_container('day', v_task.project_id, least(p_from_date, p_to_date)::text);
  if p_from_date <> p_to_date then
    if not private.is_working_day(v_task.project_id, p_to_date) then
      raise exception 'not_working_day';
    end if;

    perform private.lock_board_container('day', v_task.project_id, greatest(p_from_date, p_to_date)::text);

    -- Переносится только текущий день: planned_date — последний неотложенный день.
    if v_row.postponed or v_task.planned_date is distinct from p_from_date then
      raise exception 'task_has_history';
    end if;

    select s.id, s.work_date
      into v_prev
      from public.task_schedule s
      where s.task_id = p_task_id and s.work_date < p_from_date
      order by s.work_date desc
      limit 1;

    if found and p_to_date < v_prev.work_date then
      raise exception 'date_before_history';
    end if;

    if found and p_to_date = v_prev.work_date then
      if p_from_date < (now() at time zone v_task.timezone)::date then
        raise exception 'day_already_passed';
      end if;
      delete from public.task_schedule where id = v_row.id;
      update public.task_schedule set postponed = false where id = v_prev.id;
      v_target_id := v_prev.id;
    else
      update public.task_schedule set work_date = p_to_date where id = v_row.id;
    end if;
  end if;

  perform private.place_task_in_day(v_task.project_id, p_to_date, v_target_id, p_position);
end;
$$;
