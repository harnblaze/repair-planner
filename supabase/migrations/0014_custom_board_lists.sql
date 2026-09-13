-- Пользовательские дополнительные списки (docs/database.md §5.12).
--
-- Таблицы board_lists / board_items (0006) уже универсальны: пользовательский
-- список — строка с is_system = false. Миграция закрывает то, что до сих пор
-- держалось только на отсутствии UI:
-- 1. запросом клиента нельзя создать системный список или снять/поставить
--    признак is_system (иначе системный список можно было бы удалить,
--    а пользовательский — сделать неудаляемым);
-- 2. список не переезжает в другой проект;
-- 3. название непустое и ограничено по длине;
-- 4. порядок списков меняется атомарно (RPC move_board_list).
-- Коды исключений — стабильные строки, их переводит lib/errors.ts.

-- ================= Название =================

-- Существующие названия — системные («Материалы к заказу» и т. п.), ограничению соответствуют.
alter table public.board_lists drop constraint if exists board_lists_name_check;
alter table public.board_lists
  add constraint board_lists_name_check check (char_length(btrim(name)) between 1 and 80);

-- ================= Системные списки =================

-- Системные списки заводит только handle_new_project (security definer, RLS не
-- применяется). Клиент создаёт только пользовательские.
drop policy if exists "board_lists_insert" on public.board_lists;
create policy "board_lists_insert" on public.board_lists for insert to authenticated
  with check (public.project_can_edit(project_id) and not is_system);

-- WITH CHECK политики не видит старую строку, поэтому неизменяемость полей — триггером.
create or replace function private.guard_board_list_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_system is distinct from old.is_system then
    raise exception 'board_list_system_readonly';
  end if;

  if new.project_id is distinct from old.project_id then
    raise exception 'board_list_project_readonly';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_board_list_update() from public, anon;
grant execute on function private.guard_board_list_update() to authenticated;

drop trigger if exists board_lists_guard_update on public.board_lists;
create trigger board_lists_guard_update
  before update on public.board_lists
  for each row execute function private.guard_board_list_update();

-- ================= RPC: порядок списков =================

-- Ставит список на позицию p_position среди остальных списков проекта
-- (null — в конец) и перенумеровывает sort_order 0..n-1. Security invoker:
-- чтение и запись ограничены RLS. Без доступа к проекту список неотличим
-- от несуществующего.
create or replace function public.move_board_list(p_list_id uuid, p_position int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_count int;
  v_position int;
begin
  select l.project_id into v_project_id
    from public.board_lists l
    where l.id = p_list_id;

  if v_project_id is null then
    raise exception 'list_not_found';
  end if;

  if not public.project_can_edit(v_project_id) then
    raise exception 'access_denied';
  end if;

  perform private.lock_board_container('lists', v_project_id, '');

  select count(*) into v_count
    from public.board_lists
    where project_id = v_project_id and id <> p_list_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select l.id, (row_number() over (order by l.sort_order, l.created_at, l.id) - 1)::int as rn
      from public.board_lists l
      where l.project_id = v_project_id and l.id <> p_list_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_list_id, v_position
  )
  update public.board_lists l
    set sort_order = t.new_position
    from target t
    where l.id = t.id and l.sort_order is distinct from t.new_position;
end;
$$;

revoke all on function public.move_board_list(uuid, int) from public, anon;
grant execute on function public.move_board_list(uuid, int) to authenticated;
