-- Кто создал заявку и пункт списка. Колонка created_by была с самого начала,
-- но заполнялась только клиентом: insert-политика проверяет проект, а не
-- значение, поэтому можно было записать чужой id или не записать ничего.
-- Теперь автора ставит база — default и триггер закрывают и будущие пути
-- записи, о которых код ещё не знает.
--
-- coalesce нужен для SQL-импортов и служебных операций: там auth.uid() пуст,
-- и явно переданный автор (или null) должен остаться как есть.

alter table public.tasks alter column created_by set default auth.uid();
alter table public.board_items alter column created_by set default auth.uid();

-- Одна функция на обе таблицы: поведение одинаковое, отличается только имя
-- триггера (как с private.set_updated_at).
create or replace function private.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  return new;
end;
$$;

drop trigger if exists tasks_set_created_by on public.tasks;
create trigger tasks_set_created_by
  before insert on public.tasks
  for each row execute function private.set_created_by();

drop trigger if exists board_items_set_created_by on public.board_items;
create trigger board_items_set_created_by
  before insert on public.board_items
  for each row execute function private.set_created_by();

-- У старых строк автора нет: ставим владельца проекта — единственного, кто мог
-- их создать до появления участников. Откат невозможен: после этого исходный
-- null неотличим от честно записанного владельца.
--
-- Триггеры updated_at отключены, чтобы бэкфилл не переписал дату изменения
-- у всех исторических строк (тот же приём, что в 0023).
alter table public.tasks disable trigger tasks_set_updated_at;
alter table public.board_items disable trigger board_items_set_updated_at;

update public.tasks t
  set created_by = p.owner_id
  from public.projects p
  where t.project_id = p.id and t.created_by is null;

update public.board_items i
  set created_by = p.owner_id
  from public.projects p
  where i.project_id = p.id and i.created_by is null;

alter table public.tasks enable trigger tasks_set_updated_at;
alter table public.board_items enable trigger board_items_set_updated_at;
