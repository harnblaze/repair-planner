-- Правка своих сообщений (0036). Отдельная отметка edited_at, а не флаг: в ленте
-- видно, когда сообщение изменили, и это не заводит историю правок, которую
-- никто не просил.
--
-- Колонки created_at и author_id при правке не меняются: это контракт, его
-- проверяет pgTAP-тест. Пустое тело после правки отклонит CHECK из 0033.

alter table public.project_messages
  add column if not exists edited_at timestamptz;

-- Отметку ставит триггер, а не клиент: иначе «изменено» можно было бы не
-- поставить (или поставить задним числом) прямым запросом.
create or replace function private.touch_message_edited_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.edited_at := now();
  return new;
end;
$$;

drop trigger if exists project_messages_touch_edited_at on public.project_messages;
create trigger project_messages_touch_edited_at
  before update of body on public.project_messages
  for each row execute function private.touch_message_edited_at();

-- UPDATE-политики до этого не было вовсе: правка не входила в этап. Теперь
-- править можно только своё сообщение и только оставаясь участником проекта.
-- with check повторяет условие: политика не должна пропустить смену author_id.
drop policy if exists project_messages_update on public.project_messages;
create policy project_messages_update on public.project_messages
  for update to authenticated using (
    author_id = (select auth.uid()) and public.project_access(project_id) is not null
  )
  with check (
    author_id = (select auth.uid()) and public.project_access(project_id) is not null
  );
