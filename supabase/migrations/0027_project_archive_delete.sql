-- Архив и удаление проектов
-- (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md).

-- 1. Расход при каскадном удалении проекта. Каскад удаляет task_materials,
--    а триггер писал движение в material_movements уже удалённого проекта —
--    FK material_movements_project_id_fkey ронял удаление. Если проекта нет,
--    остаток и журнал не трогаем: они удаляются тем же каскадом. Удаление
--    расхода в живом проекте работает как прежде.
create or replace function public.apply_task_material_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 3);
  v_kind public.movement_kind;
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_material_id uuid := coalesce(new.material_id, old.material_id);
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_task_material_id uuid := coalesce(new.id, old.id);
  v_created_by uuid := coalesce(new.created_by, old.created_by);
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.projects p where p.id = old.project_id
  ) then
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_delta := -new.quantity;
    v_kind := 'consumption';
  elsif tg_op = 'UPDATE' then
    v_delta := -(new.quantity - old.quantity);
    v_kind := 'adjustment';
  else
    -- DELETE: строка task_materials уже удалена, ссылаться на неё нельзя.
    v_delta := old.quantity;
    v_kind := 'adjustment';
    v_task_material_id := null;
  end if;

  if v_delta <> 0 then
    perform set_config('repair_planner.balance_update', 'on', true);

    update public.materials
      set current_balance = current_balance + v_delta
      where id = v_material_id;

    insert into public.material_movements
      (project_id, material_id, kind, quantity, task_id, task_material_id, created_by)
    values
      (v_project_id, v_material_id, v_kind, v_delta, v_task_id, v_task_material_id, v_created_by);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- 2. Удалить можно только проект в архиве — защита от случайного удаления
--    активного проекта и прямым запросом к API.
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete to authenticated
  using (public.project_access(id) = 'owner' and archived_at is not null);

-- 3. Пути файлов архивного проекта для удаления через Storage API перед
--    удалением строки проекта (после него RLS storage.objects файлы не отдаст).
--    security invoker: RLS storage.objects действует; только владельцу.
create or replace function public.project_attachment_paths(
  p_project_id uuid,
  p_limit int default 1000
)
returns setof text
language sql
stable
set search_path = ''
as $$
  select o.name
    from storage.objects o
    where public.project_access(p_project_id) = 'owner'
      and exists (
        select 1 from public.projects p
          where p.id = p_project_id and p.archived_at is not null
      )
      and o.bucket_id = 'task-attachments'
      and o.name like p_project_id::text || '/%'
    order by o.name
    limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$$;

revoke all on function public.project_attachment_paths(uuid, int) from public, anon;
grant execute on function public.project_attachment_paths(uuid, int) to authenticated;
