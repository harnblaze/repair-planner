-- move_backlog_task: проверки — по строке заявки, прочитанной после блокировок
-- (docs/superpowers/specs/2026-10-08-task-queues-design.md).
-- В 0018 заявка читалась до блокировки очередей: если её одновременно переносил
-- другой редактор, функция ставила позицию по устаревшей очереди.
-- Теперь: первое чтение — только чтобы узнать, какие очереди блокировать;
-- после блокировок строка заявки перечитывается FOR UPDATE и все проверки
-- повторяются. Блокировка строки — после очередей, а не до: перенумерация
-- очереди обновляет все её строки, обратный порядок дал бы взаимную блокировку.

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
  select t.id, t.project_id, t.queue_id
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

  if p_queue_id is not null and not exists (
    select 1 from public.task_queues q
      where q.id = p_queue_id and q.project_id = v_task.project_id
  ) then
    raise exception 'queue_not_found';
  end if;

  -- Обе очереди и в порядке ключей: встречные переносы не заблокируют друг друга,
  -- параллельная перестановка любой из двух очередей ждёт окончания этой.
  v_from_key := coalesce(v_task.queue_id::text, '');
  v_to_key := coalesce(p_queue_id::text, '');
  perform private.lock_board_container('queue', v_task.project_id, least(v_from_key, v_to_key));
  if v_from_key <> v_to_key then
    perform private.lock_board_container('queue', v_task.project_id, greatest(v_from_key, v_to_key));
  end if;

  -- Состояние заявки на момент блокировок; FOR UPDATE держит его до конца транзакции.
  select t.id, t.project_id, t.status, t.planned_date, t.queue_id
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;

  -- Пока ждали блокировку, заявку увели в другую очередь: её очередь не заблокирована,
  -- брать блокировку не по порядку ключей нельзя — пусть пользователь обновит доску.
  if coalesce(v_task.queue_id::text, '') <> v_from_key then
    raise exception 'task_moved';
  end if;

  if v_task.planned_date is not null then
    raise exception 'task_already_planned';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;

  if v_from_key <> v_to_key then
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
