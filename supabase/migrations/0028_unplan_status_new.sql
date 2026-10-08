-- Снятие задачи с плана возвращает статус planned → new
-- (docs/roadmap.md, открытый вопрос «Возвращать ли статус planned → new…»).
--
-- Раньше задача, снятая с плана перетаскиванием в «Текущие заявки» или
-- очисткой даты в карточке, оставалась «Запланированной» без даты. Работа по
-- ней не начиналась, поэтому она снова «Новая». in_progress и paused не
-- меняются: работа уже шла, прошедшие дни остаются историей.
-- Тела функций — как в 0008 и 0015, кроме смены статуса.

-- 1. Перетаскивание в «Текущие заявки» (0008).
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
    if v_task.status = 'planned' then
      update public.tasks set status = 'new' where id = p_task_id;
    end if;
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

-- 2. Очистка даты в карточке (0015). p_work_date is null снимает весь план.
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
    if v_task.status = 'planned' then
      update public.tasks set status = 'new' where id = p_task_id;
    end if;
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

-- 3. Разовая чистка: задачи, уже снятые с плана до этой миграции.
update public.tasks set status = 'new' where status = 'planned' and planned_date is null;
