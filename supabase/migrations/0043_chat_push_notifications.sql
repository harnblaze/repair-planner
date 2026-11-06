-- Кому рассылать уведомления о сообщении в чате (0043).
--
-- Отправка идёт с сервера приложения под сессией автора сообщения: service-role
-- ключа в проекте нет и он не нужен. Значит, чужие подписки можно прочитать
-- только функцией — RLS таблицы (0042) отдаёт человеку лишь его собственные
-- строки, а рассылка нужна всем участникам проекта.
--
-- Функция SECURITY DEFINER, поэтому членство проверяется явно: без доступа к
-- проекту она не отдаёт ничего, а не «всё, что есть в таблице».

create or replace function public.project_push_subscriptions(p_project_id uuid)
returns table (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.user_id, ps.endpoint, ps.p256dh, ps.auth
  from public.push_subscriptions ps
  join public.project_members pm on pm.user_id = ps.user_id
  where pm.project_id = p_project_id
    and public.project_access(p_project_id) is not null;
$$;

grant execute on function public.project_push_subscriptions(uuid) to authenticated;

-- Уборка мёртвых подписок (push-сервис ответил 410/404).
--
-- Удалять чужие строки прямым запросом нельзя — RLS разрешает только свои.
-- Здесь удаление разрешено лишь для подписок людей, с которыми вызывающий
-- состоит хотя бы в одном общем проекте: тот, кто получил «мёртвый» ответ при
-- рассылке, в этом проекте и находится. Случайный чужой endpoint так не снести.
create or replace function public.prune_push_subscriptions(p_endpoints text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  delete from public.push_subscriptions ps
  where ps.endpoint = any (p_endpoints)
    and exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid()
        and theirs.user_id = ps.user_id
    );

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

grant execute on function public.prune_push_subscriptions(text[]) to authenticated;
