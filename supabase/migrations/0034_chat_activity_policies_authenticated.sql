-- Политики новых таблиц были объявлены без роли и потому применялись и к
-- анониму. Аноним не имеет права EXECUTE на public.project_access(), поэтому
-- PostgREST отвечал 401 «permission denied for function project_access» вместо
-- пустого списка. В проекте принято ограничивать политики ролью authenticated
-- (см. 0004, 0012) — приводим новые таблицы к тому же виду.
--
-- Функция для authenticated доступна: приложение работает под этой ролью.
-- Это чистая гигиена доступа: поведение вошедшего пользователя не меняется.

-- ── Журнал (0032) ────────────────────────────────────────────────────────────

drop policy if exists project_activity_select on public.project_activity;
create policy project_activity_select on public.project_activity
  for select to authenticated using (public.project_access(project_id) is not null);

-- ── Чат (0033) ───────────────────────────────────────────────────────────────

drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages
  for select to authenticated using (public.project_access(project_id) is not null);

drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages
  for insert to authenticated with check (
    public.project_can_edit(project_id) and author_id = (select auth.uid())
  );

drop policy if exists project_messages_delete on public.project_messages;
create policy project_messages_delete on public.project_messages
  for delete to authenticated using (
    author_id = (select auth.uid()) and public.project_access(project_id) is not null
  );

drop policy if exists project_message_reads_select on public.project_message_reads;
create policy project_message_reads_select on public.project_message_reads
  for select to authenticated using (user_id = (select auth.uid()) and public.project_access(project_id) is not null);

drop policy if exists project_message_reads_insert on public.project_message_reads;
create policy project_message_reads_insert on public.project_message_reads
  for insert to authenticated with check (user_id = (select auth.uid()) and public.project_access(project_id) is not null);

drop policy if exists project_message_reads_update on public.project_message_reads;
create policy project_message_reads_update on public.project_message_reads
  for update to authenticated using (user_id = (select auth.uid()) and public.project_access(project_id) is not null)
  with check (user_id = (select auth.uid()) and public.project_access(project_id) is not null);
