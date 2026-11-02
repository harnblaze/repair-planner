-- Чат проекта: сообщения и отметки о прочитанном (0033, этап A — только база).
--
-- Первая фича, которая читается и пишется сразу из браузера (Supabase Realtime):
-- подписка приходит клиенту напрямую, минуя серверный код. Поэтому границей
-- доступа остаётся RLS, а не экшены: политики ниже — единственное, что решает,
-- кто что видит и кому можно писать.
--
-- id сообщения генерирует клиент и передаёт явно — БЕЗ default. Это даёт две
-- вещи: оптимистичная вставка в UI и событие Realtime приходят с одним и тем же
-- id, и клиент не задваивает сообщение, когда событие догоняет его собственный
-- insert.

create table if not exists public.project_messages (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Автор. default + триггер ниже: клиент не может записать чужое авторство.
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint project_messages_body_length check (length(btrim(body)) between 1 and 2000)
);

create index if not exists project_messages_project_time_idx
  on public.project_messages (project_id, created_at desc);

alter table public.project_messages alter column author_id set default auth.uid();

-- Тот же приём, что в 0031: coalesce оставляет явного автора для SQL-импортов,
-- где auth.uid() пуст, а из клиента автора всегда перезаписывает на вошедшего.
create or replace function private.set_message_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := coalesce((select auth.uid()), new.author_id);
  return new;
end;
$$;

drop trigger if exists project_messages_set_author on public.project_messages;
create trigger project_messages_set_author
  before insert on public.project_messages
  for each row execute function private.set_message_author();

-- Отметка «дочитал до». Одна строка на участника и проект.
create table if not exists public.project_message_reads (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.project_messages enable row level security;

-- Читают участники проекта.
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages
  for select using (public.project_access(project_id) is not null);

-- Пишут те, кто может редактировать проект, и только от своего имени.
-- Проверка author_id дублирует триггер намеренно: политика описывает контракт,
-- триггер гарантирует его даже для путей, которые политику обойдут.
drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages
  for insert with check (
    public.project_can_edit(project_id) and author_id = (select auth.uid())
  );

-- Удалить можно только своё сообщение и только оставаясь участником проекта.
drop policy if exists project_messages_delete on public.project_messages;
create policy project_messages_delete on public.project_messages
  for delete using (
    author_id = (select auth.uid()) and public.project_access(project_id) is not null
  );

-- UPDATE-политики нет намеренно: правка сообщений не входит в этап.

alter table public.project_message_reads enable row level security;

-- Отметку видит и меняет только её владелец.
drop policy if exists project_message_reads_select on public.project_message_reads;
create policy project_message_reads_select on public.project_message_reads
  for select using (user_id = (select auth.uid()) and public.project_access(project_id) is not null);

drop policy if exists project_message_reads_insert on public.project_message_reads;
create policy project_message_reads_insert on public.project_message_reads
  for insert with check (user_id = (select auth.uid()) and public.project_access(project_id) is not null);

drop policy if exists project_message_reads_update on public.project_message_reads;
create policy project_message_reads_update on public.project_message_reads
  for update using (user_id = (select auth.uid()) and public.project_access(project_id) is not null)
  with check (user_id = (select auth.uid()) and public.project_access(project_id) is not null);

-- ── Realtime ─────────────────────────────────────────────────────────────────

-- Публикация только включает поток изменений; RLS продолжает действовать и на
-- Realtime — подписчик получает лишь те строки, которые ему разрешено читать.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'project_messages'
     )
  then
    alter publication supabase_realtime add table public.project_messages;
  end if;
exception
  when others then
    raise notice 'Realtime: project_messages не добавлена в публикацию (%)', sqlerrm;
end;
$$;

-- ── Чистка старше 12 месяцев ─────────────────────────────────────────────────

create or replace function public.purge_project_messages(p_keep interval default '12 months')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.project_messages
   where created_at < now() - p_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Чистка — не пользовательская операция: участник не должен уметь стереть
-- чужую переписку. Зовут планировщик (postgres) и service_role.
revoke all on function public.purge_project_messages(interval) from public, anon, authenticated;
grant execute on function public.purge_project_messages(interval) to service_role;

do $$
begin
  create extension if not exists pg_cron;

  if not exists (select 1 from cron.job where jobname = 'purge-project-messages') then
    perform cron.schedule(
      'purge-project-messages',
      '15 3 * * *',
      'select public.purge_project_messages();'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron недоступен (%), чистка чата — вручную: select public.purge_project_messages();', sqlerrm;
end;
$$;
