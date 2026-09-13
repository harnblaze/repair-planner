-- Роль viewer — только просмотр данных проекта (docs/database.md §3).
--
-- Отдельная миграция: новое значение enum нельзя использовать в той же
-- транзакции, в которой оно добавлено, а 0012 на него ссылается.

alter type public.project_role add value if not exists 'viewer';
