-- Уведомления на телефон (0042).
--
-- Web Push: устройство подписывается на пуши у браузера и присылает три
-- значения — endpoint (адрес push-сервиса именно этого устройства) и пару
-- ключей шифрования (p256dh, auth). Одно устройство — одна строка; у одного
-- человека их может быть несколько: телефон, планшет, второй браузер.
--
-- Что здесь НЕ хранится: приватный VAPID-ключ. Без него отправить пуш нельзя,
-- и живёт он только в переменных окружения сервера. Поэтому утечка этой
-- таблицы не даёт возможности рассылать уведомления от имени приложения.
--
-- Почему запись через функцию, а не прямым INSERT: подписка принадлежит
-- устройству, а не человеку. На общем планшете под одним endpoint сначала
-- подписывается один аккаунт, потом другой — и строка должна перейти к новому
-- владельцу (старый в этот момент уже не получит ничего, устройство-то одно).
-- С RLS-политикой «только своё» такой перенос запрещён, а ослаблять политику
-- значит разрешить любому перехватывать чужой endpoint.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Переподписка на том же устройстве обновляет строку, а не плодит дубли.
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Читать и удалять — только свои подписки. Вставка и правка идут через
-- функцию ниже: у неё есть право перенести строку на нового владельца.
drop policy if exists "push_subscriptions_select" on public.push_subscriptions;
create policy "push_subscriptions_select" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete" on public.push_subscriptions;
create policy "push_subscriptions_delete" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Сохранение подписки устройства. Возвращает true, если подписка записана.
-- Вызывается только из приложения под сессией пользователя: анонимного
-- доступа нет, а user_id всегда берётся из auth.uid(), а не из аргументов.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return false;
  end if;

  if coalesce(btrim(p_endpoint), '') = ''
     or coalesce(btrim(p_p256dh), '') = ''
     or coalesce(btrim(p_auth), '') = '' then
    return false;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), nullif(btrim(p_user_agent), ''))
  on conflict (endpoint) do update
    set user_id = v_user,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();

  return true;
end;
$$;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
