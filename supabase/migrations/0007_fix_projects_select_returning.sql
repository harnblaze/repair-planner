-- Исправление RLS: INSERT ... RETURNING на projects падал с
-- "new row violates row-level security policy".
--
-- Политика projects_select проверяла доступ только через project_access(id),
-- которая читает project_members. Эта строка появляется в project_members
-- только после AFTER INSERT-триггера handle_new_project (0002). При
-- `insert into projects (...) returning ...` Postgres проверяет RLS для
-- RETURNING по снапшоту, который ещё не видит строку, добавленную триггером
-- в рамках той же команды — INSERT проходит (WITH CHECK по owner_id
-- выполняется), а RETURNING получает отказ RLS.
--
-- Решение: добавить в SELECT-политику прямую проверку owner_id — она не
-- зависит от project_members и не подвержена этой гонке видимости.
-- project_access(id) остаётся для доступа участников, не являющихся
-- владельцем (когда появятся приглашения).

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) or public.project_access(id) is not null);
