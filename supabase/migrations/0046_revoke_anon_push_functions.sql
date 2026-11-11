-- Забрать EXECUTE у anon у функций push и непрочитанных (0046).
--
-- Supabase выдаёт EXECUTE на каждую новую функцию в public ролям anon и
-- authenticated (default privileges), поэтому grant ... to authenticated не
-- снимает доступ у anon: он остаётся с EXECUTE по умолчанию. Все пять функций
-- появились в 0042–0044 и проверяют auth.uid() внутри, так что данных anon не
-- получает, но инвариант «у anon нет ни одной функции в public» (pgTAP
-- rls.test.sql) был сломан — восстановим.
--
-- revoke from public обязателен: EXECUTE у anon приходит именно через него,
-- а точечный grant authenticated уже стоит в своих миграциях.

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.project_push_subscriptions(uuid) from public, anon;
revoke execute on function public.prune_push_subscriptions(text[]) from public, anon;
revoke execute on function public.chat_unread_total() from public, anon;
revoke execute on function public.project_chat_unread(uuid) from public, anon;
