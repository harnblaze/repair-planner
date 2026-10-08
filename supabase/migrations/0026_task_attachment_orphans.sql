-- Поиск файлов-«сирот» в bucket task-attachments
-- (docs/superpowers/specs/2026-10-08-attachment-orphan-cleanup-design.md):
-- объекты проекта старше суток без строки task_attachments — оборванные
-- загрузки и сбои удаления. Удаляет их сервер через Storage API сессией
-- пользователя (прямой delete из storage.objects запрещён платформой).
-- security invoker: RLS storage.objects и task_attachments действует; список
-- получают только редакторы — удалять файлы остальные всё равно не могут.
-- Сутки защищают загрузки в процессе (подписанная ссылка живёт 2 часа).

create or replace function public.task_attachment_orphans(
  p_project_id uuid,
  p_limit int default 100
)
returns setof text
language sql
stable
set search_path = ''
as $$
  select o.name
    from storage.objects o
    where public.project_can_edit(p_project_id)
      and o.bucket_id = 'task-attachments'
      and o.name like p_project_id::text || '/%'
      and o.created_at < now() - interval '1 day'
      and not exists (
        select 1 from public.task_attachments a where a.storage_path = o.name
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$$;

revoke all on function public.task_attachment_orphans(uuid, int) from public, anon;
grant execute on function public.task_attachment_orphans(uuid, int) to authenticated;
