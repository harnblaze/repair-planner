-- Фото к сообщениям чата (0037). Устроено так же, как task_attachments (0017):
-- приватный bucket chat-attachments, путь {project_id}/{message_id}/{uuid}.jpg,
-- доступ двумя слоями — RLS таблицы и RLS storage.objects по первой папке пути.
-- Service role не используется.
--
-- Отличие от задач: у сообщения может не быть текста, если есть хотя бы одно
-- вложение. Поэтому CHECK тела ослаблен до 0 символов, а «пустое сообщение без
-- фото» ловит ОТЛОЖЕННЫЙ constraint-триггер: сообщение и вложения пишутся одной
-- транзакцией, и проверка выполняется на коммите, когда вложения уже на месте.

-- ================= Тело сообщения: 0…2000 =================

alter table public.project_messages
  drop constraint if exists project_messages_body_length;

alter table public.project_messages
  add constraint project_messages_body_length
  check (length(btrim(body)) between 0 and 2000);

-- ================= Составной ключ для FK вложений =================
-- Вложения ссылаются на (id, project_id), чтобы сообщение и проект нельзя было
-- перепутать. У project_messages сейчас PK только по id.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.project_messages'::regclass
       and conname = 'project_messages_id_project_key'
  ) then
    alter table public.project_messages
      add constraint project_messages_id_project_key unique (id, project_id);
  end if;
end;
$$;

-- ================= Bucket =================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ================= Таблица =================

create table if not exists public.project_message_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  message_id uuid not null,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (message_id, project_id)
    references public.project_messages (id, project_id) on delete cascade,
  -- Путь принадлежит именно этому сообщению этого проекта и имеет вид {uuid}.jpg.
  constraint project_message_attachments_path_matches_message check (
    storage_path ~ ('^' || project_id::text || '/' || message_id::text
                    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
);

create index if not exists project_message_attachments_message_idx
  on public.project_message_attachments (message_id, created_at);

-- ================= RLS таблицы =================
-- SELECT — любой участник; INSERT/DELETE — owner, member; UPDATE — никто.

alter table public.project_message_attachments enable row level security;

drop policy if exists project_message_attachments_select on public.project_message_attachments;
create policy project_message_attachments_select on public.project_message_attachments
  for select to authenticated
  using (public.project_access(project_id) is not null);

-- Составной FK уже гарантирует, что message_id из этого проекта; exists
-- повторяет контракт явно, как в 0017.
drop policy if exists project_message_attachments_insert on public.project_message_attachments;
create policy project_message_attachments_insert on public.project_message_attachments
  for insert to authenticated
  with check (
    public.project_can_edit(project_id)
    and exists (
      select 1 from public.project_messages m
       where m.id = message_id and m.project_id = project_id
    )
  );

drop policy if exists project_message_attachments_delete on public.project_message_attachments;
create policy project_message_attachments_delete on public.project_message_attachments
  for delete to authenticated
  using (public.project_can_edit(project_id));

-- ================= RLS storage.objects =================
-- Первая папка пути — проект; private.attachment_project_id уже есть из 0017.

drop policy if exists chat_attachments_objects_select on storage.objects;
create policy chat_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.project_access(private.attachment_project_id(name)) is not null
  );

drop policy if exists chat_attachments_objects_insert on storage.objects;
create policy chat_attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );

drop policy if exists chat_attachments_objects_delete on storage.objects;
create policy chat_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );

-- ================= Сообщение без текста, но с фото =================

-- Отложенная проверка: на момент insert вложения ещё не вставлены, поэтому
-- проверять надо на коммите транзакции. Так фото и сообщение пишутся вместе,
-- и «совсем пустое» сообщение отклонить не забудут ни в одном пути записи.
create or replace function private.ensure_message_body_or_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if btrim(new.body) <> '' then
    return new;
  end if;

  if exists (
    select 1 from public.project_message_attachments a where a.message_id = new.id
  ) then
    return new;
  end if;

  raise exception 'message_empty'
    using errcode = '23514',
          hint = 'Добавьте текст или хотя бы одно фото.';
end;
$$;

drop trigger if exists project_messages_body_or_attachment on public.project_messages;
create constraint trigger project_messages_body_or_attachment
  after insert or update of body on public.project_messages
  deferrable initially deferred
  for each row execute function private.ensure_message_body_or_attachment();

-- ================= RPC: сообщение с вложениями одной транзакцией =================

create or replace function public.create_chat_message(
  p_project_id uuid,
  p_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns public.project_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := coalesce(p_body, '');
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_item jsonb;
  v_path text;
  v_inserted public.project_messages;
begin
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'attachments_invalid' using errcode = '22023';
  end if;

  -- Больше четырёх фото к одному сообщению не разрешаем: в чате это уже стена.
  if jsonb_array_length(v_attachments) > 4 then
    raise exception 'attachments_too_many'
      using errcode = '22023', hint = 'К сообщению можно приложить не больше четырёх фото.';
  end if;

  -- Пусто и без фото — отказ сразу и понятным кодом, не дожидаясь триггера.
  if btrim(v_body) = '' and jsonb_array_length(v_attachments) = 0 then
    raise exception 'message_empty'
      using errcode = '22023', hint = 'Добавьте текст или хотя бы одно фото.';
  end if;

  -- Каждое вложение: объект с путём и размерами, путь — этого проекта и этого
  -- сообщения. Форму пути окончательно проверяет CHECK таблицы.
  for v_item in select * from jsonb_array_elements(v_attachments)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'attachments_invalid' using errcode = '22023';
    end if;

    v_path := v_item ->> 'path';

    if v_path is null
       or (v_item ->> 'size_bytes') is null
       or (v_item ->> 'width') is null
       or (v_item ->> 'height') is null
    then
      raise exception 'attachments_invalid' using errcode = '22023';
    end if;

    if (v_item ->> 'size_bytes')::int <= 0
       or (v_item ->> 'width')::int <= 0
       or (v_item ->> 'height')::int <= 0
    then
      raise exception 'attachments_invalid' using errcode = '22023';
    end if;

    if v_path not like p_project_id::text || '/' || p_id::text || '/%' then
      raise exception 'attachment_path_mismatch'
        using errcode = '22023', hint = 'Путь файла не принадлежит этому сообщению.';
    end if;
  end loop;

  insert into public.project_messages (id, project_id, body)
  values (p_id, p_project_id, v_body)
  returning * into v_inserted;

  insert into public.project_message_attachments
    (project_id, message_id, storage_path, size_bytes, width, height)
  select p_project_id, p_id, a.path, a.size_bytes, a.width, a.height
    from jsonb_to_recordset(v_attachments)
      as a(path text, size_bytes int, width int, height int);

  return v_inserted;
end;
$$;

revoke all on function public.create_chat_message(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.create_chat_message(uuid, uuid, text, jsonb) to authenticated;

-- ================= Сироты =================
-- Копия 0026 для нового bucket: файлы старше суток без строки в таблице —
-- оборванные загрузки и сбои удаления. Удаляет их сервер через Storage API
-- сессией пользователя (прямой delete из storage.objects платформа запрещает).
-- security invoker: RLS обоих слоёв действует.

create or replace function public.chat_attachment_orphans(
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
      and o.bucket_id = 'chat-attachments'
      and o.name like p_project_id::text || '/%'
      and o.created_at < now() - interval '1 day'
      and not exists (
        select 1 from public.project_message_attachments a where a.storage_path = o.name
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$$;

revoke all on function public.chat_attachment_orphans(uuid, int) from public, anon;
grant execute on function public.chat_attachment_orphans(uuid, int) to authenticated;
