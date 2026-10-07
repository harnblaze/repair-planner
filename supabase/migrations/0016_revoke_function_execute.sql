-- Права на вызов функций через API (docs/database.md §6.3).
--
-- Supabase выдаёт EXECUTE на новые функции схемы public ролям anon и
-- authenticated напрямую (default privileges), поэтому `revoke ... from public`
-- в прежних миграциях их не снимал: функции оставались доступны через
-- /rest/v1/rpc/<name>, в том числе без входа (Supabase security advisor:
-- anon_security_definer_function_executable).
--
-- 1. Триггерные функции не вызываются через API никем. Postgres проверяет
--    EXECUTE на триггерную функцию только при CREATE TRIGGER, а не при
--    срабатывании, поэтому триггеры продолжают работать.
-- 2. project_access нужен только authenticated: все RLS-политики объявлены
--    `to authenticated`, anon их не вычисляет.
--
-- Новые функции в public: всегда `revoke all ... from public, anon` и явный
-- grant нужной роли (проверяется pgTAP-тестом «anon cannot execute any function»).

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_new_project() from public, anon, authenticated;
revoke all on function public.apply_task_material_change() from public, anon, authenticated;
revoke all on function public.guard_materials_balance() from public, anon, authenticated;
revoke all on function public.guard_tasks_planned_date() from public, anon, authenticated;
revoke all on function public.recalc_task_planned_date() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.validate_project_timezone() from public, anon, authenticated;

revoke all on function public.project_access(uuid) from anon;
