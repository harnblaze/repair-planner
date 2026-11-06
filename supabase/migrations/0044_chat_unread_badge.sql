-- Непрочитанные сообщения для значка приложения (0044).
--
-- Значок на иконке — это одно число на всё приложение, поэтому нужен итог по
-- всем проектам человека, а не по открытому. Считать его в браузере нельзя:
-- данные других проектов туда не загружаются, да и значок нужен без открытия
-- приложения — его ставит сервис-воркер из пуша.
--
-- Отметка «прочитано до» лежит в project_message_reads, счётчика нет
-- намеренно (0033): иначе на каждое сообщение пришлось бы писать каждому
-- участнику. Здесь тот же принцип — считаем на чтении.

create or replace function public.chat_unread_total()
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum((
    select count(*)
    from public.project_messages m
    where m.project_id = pm.project_id
      and m.author_id <> pm.user_id
      and (r.last_read_at is null or m.created_at > r.last_read_at)
  )), 0)::integer
  from public.project_members pm
  left join public.project_message_reads r
    on r.project_id = pm.project_id and r.user_id = pm.user_id
  where pm.user_id = (select auth.uid());
$$;

grant execute on function public.chat_unread_total() to authenticated;

-- Непрочитанное по участникам проекта — для значка в уведомлении.
--
-- Отправка идёт под сессией автора сообщения: свои непрочитанные он и так
-- видит, а чужие нужны, чтобы поставить правильное число на иконку получателя,
-- даже когда приложение закрыто. SECURITY DEFINER с проверкой членства, как в
-- 0043: без доступа к проекту функция не отдаёт ничего.
--
-- Считается ИТОГ по всем проектам человека, а не только по этому: значок на
-- иконке один, и число в нём должно совпадать с тем, что человек увидит,
-- открыв приложение.
create or replace function public.project_chat_unread(p_project_id uuid)
returns table (user_id uuid, unread integer)
language sql
stable
security definer
set search_path = ''
as $$
  select member.user_id,
         coalesce((
           select sum((
             select count(*)
             from public.project_messages m
             where m.project_id = pm.project_id
               and m.author_id <> pm.user_id
               and (read.last_read_at is null or m.created_at > read.last_read_at)
           ))
           from public.project_members pm
           left join public.project_message_reads read
             on read.project_id = pm.project_id and read.user_id = pm.user_id
           where pm.user_id = member.user_id
         ), 0)::integer as unread
  from public.project_members member
  where member.project_id = p_project_id
    and public.project_access(p_project_id) is not null;
$$;

grant execute on function public.project_chat_unread(uuid) to authenticated;
