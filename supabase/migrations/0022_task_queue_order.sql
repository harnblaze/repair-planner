-- Ручной порядок своих очередей (панели на доске, выпадающие списки).
-- «Текущие заявки» (queue_id is null) строки не имеют и всегда идут первыми.
-- Повторяет порядок дополнительных списков (0014: board_lists.sort_order, move_board_list).

alter table public.task_queues add column if not exists sort_order int not null default 0;

-- Существующие очереди сохраняют прежний порядок — по дате создания.
with numbered as (
  select q.id, (row_number() over (partition by q.project_id order by q.created_at, q.id) - 1)::int as rn
    from public.task_queues q
)
update public.task_queues q
  set sort_order = n.rn
  from numbered n
  where q.id = n.id and q.sort_order is distinct from n.rn;

drop index if exists public.task_queues_project_idx;
create index if not exists task_queues_project_order_idx on public.task_queues (project_id, sort_order, created_at);

-- 0018 выдал UPDATE только на name; порядок меняет move_task_queue (security
-- invoker), поэтому нужно право и на sort_order. Запись ограничена RLS (project_can_edit).
grant update (sort_order) on public.task_queues to authenticated;

-- Ставит очередь на позицию p_position среди очередей проекта (null — в конец)
-- и перенумеровывает sort_order 0..n-1. Без доступа к проекту очередь
-- неотличима от несуществующей.
create or replace function public.move_task_queue(p_queue_id uuid, p_position int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_count int;
  v_position int;
begin
  select q.project_id into v_project_id
    from public.task_queues q
    where q.id = p_queue_id;

  if v_project_id is null then
    raise exception 'queue_not_found';
  end if;

  if not public.project_can_edit(v_project_id) then
    raise exception 'access_denied';
  end if;

  perform private.lock_board_container('queues', v_project_id, '');

  select count(*) into v_count
    from public.task_queues
    where project_id = v_project_id and id <> p_queue_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select q.id, (row_number() over (order by q.sort_order, q.created_at, q.id) - 1)::int as rn
      from public.task_queues q
      where q.project_id = v_project_id and q.id <> p_queue_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_queue_id, v_position
  )
  update public.task_queues q
    set sort_order = t.new_position
    from target t
    where q.id = t.id and q.sort_order is distinct from t.new_position;
end;
$$;

revoke all on function public.move_task_queue(uuid, int) from public, anon;
grant execute on function public.move_task_queue(uuid, int) to authenticated;
