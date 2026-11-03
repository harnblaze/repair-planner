-- Ответы на сообщения (0039). Ссылка на оригинал плюс снимок его текста и автора.
--
-- Зачем снимок, если есть ссылка: FK стоит с on delete set null, поэтому после
-- удаления оригинала ссылка обнуляется. Без снимка ответ выглядел бы как обычное
-- сообщение — непонятно, что это был ответ. Снимок даёт возможность показать
-- «Сообщение удалено» и сохранить автора цитаты.
--
-- Снимок делает триггер, а не клиент: иначе текст цитаты можно подменить прямым
-- запросом. Он же проверяет, что оригинал из того же проекта: отвечать на
-- сообщение чужого проекта нельзя даже зная его id.

alter table public.project_messages
  add column if not exists reply_to_id uuid,
  add column if not exists reply_to_body text,
  add column if not exists reply_to_author_id uuid;

-- add constraint не умеет if not exists — ловим повторный запуск миграции.
do $$
begin
  alter table public.project_messages
    add constraint project_messages_reply_to_fkey
    foreign key (reply_to_id) references public.project_messages(id) on delete set null;
exception
  when duplicate_object then null;
end;
$$;

-- Частичный индекс: ответов меньше, чем сообщений, и null-строки в нём не нужны.
create index if not exists project_messages_reply_to_idx
  on public.project_messages(reply_to_id)
  where reply_to_id is not null;

comment on column public.project_messages.reply_to_id is
  'Сообщение, на которое это отвечает. Обнуляется при удалении оригинала, снимок ниже остаётся.';
comment on column public.project_messages.reply_to_body is
  'Текст оригинала на момент ответа: цитата в пузыре и «Сообщение удалено» после удаления.';
comment on column public.project_messages.reply_to_author_id is
  'Автор оригинала на момент ответа — чьё имя писать в цитате.';

create or replace function private.fill_message_reply_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text;
  v_author uuid;
begin
  -- Ссылки нет: обычное сообщение или FK только что обнулил её при удалении
  -- оригинала. Снимок в обоих случаях НЕ трогаем — именно он позволяет
  -- показать «Сообщение удалено», когда ссылка уже исчезла. Чистить его здесь
  -- нельзя: on delete set null сам вызывает этот триггер.
  if new.reply_to_id is null then
    return new;
  end if;

  select m.body, m.author_id into v_body, v_author
    from public.project_messages m
   where m.id = new.reply_to_id
     and m.project_id = new.project_id;

  if not found then
    raise exception 'reply_target_invalid'
      using errcode = '22023',
            hint = 'Сообщение, на которое отвечаете, больше недоступно.';
  end if;

  new.reply_to_body := v_body;
  new.reply_to_author_id := v_author;
  return new;
end;
$$;

drop trigger if exists project_messages_fill_reply on public.project_messages;
create trigger project_messages_fill_reply
  before insert or update of reply_to_id on public.project_messages
  for each row execute function private.fill_message_reply_snapshot();

-- ================= RPC: сообщение с вложениями и цитатой =================
-- Сигнатура меняется (появляется p_reply_to_id), поэтому старую функцию с
-- четырьмя аргументами надо убрать: create or replace создал бы перегрузку,
-- и вызов с именованными аргументами стал бы неоднозначным.
-- Пятый аргумент необязателен — старые вызовы продолжают работать.

drop function if exists public.create_chat_message(uuid, uuid, text, jsonb);

create or replace function public.create_chat_message(
  p_project_id uuid,
  p_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb,
  p_reply_to_id uuid default null
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
  v_kind text;
  v_mime text;
  v_size int;
  v_width int;
  v_height int;
  v_ok boolean;
  v_inserted public.project_messages;
begin
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'attachments_invalid' using errcode = '22023';
  end if;

  -- Больше четырёх вложений к одному сообщению не разрешаем: в чате это стена.
  if jsonb_array_length(v_attachments) > 4 then
    raise exception 'attachments_too_many'
      using errcode = '22023', hint = 'К сообщению можно приложить не больше четырёх файлов.';
  end if;

  -- Пусто и без вложений — отказ сразу и понятным кодом, не дожидаясь триггера.
  if btrim(v_body) = '' and jsonb_array_length(v_attachments) = 0 then
    raise exception 'message_empty'
      using errcode = '22023', hint = 'Добавьте текст или хотя бы один файл.';
  end if;

  for v_item in select * from jsonb_array_elements(v_attachments)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'attachments_invalid' using errcode = '22023';
    end if;

    v_path := v_item ->> 'path';
    v_kind := coalesce(v_item ->> 'kind', 'image');
    v_mime := coalesce(v_item ->> 'mime_type', 'image/jpeg');
    v_size := nullif(v_item ->> 'size_bytes', '')::int;
    v_width := nullif(v_item ->> 'width', '')::int;
    v_height := nullif(v_item ->> 'height', '')::int;

    if v_path is null or v_size is null or v_size <= 0 then
      raise exception 'attachments_invalid' using errcode = '22023';
    end if;

    if v_kind not in ('image', 'document') then
      raise exception 'attachment_kind_unknown'
        using errcode = '22023', hint = 'Вложение может быть картинкой или документом.';
    end if;

    if v_kind = 'image' then
      if v_width is null or v_height is null or v_width <= 0 or v_height <= 0 then
        raise exception 'attachment_image_size_missing'
          using errcode = '22023', hint = 'У картинки должны быть ширина и высота.';
      end if;
      if v_mime <> 'image/jpeg' or v_path !~ '\.jpg$' then
        raise exception 'attachment_mime_mismatch'
          using errcode = '22023', hint = 'Картинка должна быть JPEG с расширением .jpg.';
      end if;
    else
      if v_width is not null or v_height is not null then
        raise exception 'attachment_document_has_size'
          using errcode = '22023', hint = 'У документа не бывает ширины и высоты.';
      end if;

      -- Расширение и mime должны описывать один и тот же формат.
      v_ok := case
        when v_path ~ '\.pdf$' then v_mime = 'application/pdf'
        when v_path ~ '\.doc$' then v_mime = 'application/msword'
        when v_path ~ '\.docx$' then v_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        when v_path ~ '\.xls$' then v_mime = 'application/vnd.ms-excel'
        when v_path ~ '\.xlsx$' then v_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        when v_path ~ '\.txt$' then v_mime = 'text/plain'
        when v_path ~ '\.csv$' then v_mime = 'text/csv'
        else false
      end;

      if not coalesce(v_ok, false) then
        raise exception 'attachment_mime_mismatch'
          using errcode = '22023',
                hint = 'Расширение файла не совпадает с его типом.';
      end if;
    end if;

    if v_path not like p_project_id::text || '/' || p_id::text || '/%' then
      raise exception 'attachment_path_mismatch'
        using errcode = '22023', hint = 'Путь файла не принадлежит этому сообщению.';
    end if;
  end loop;

  insert into public.project_messages (id, project_id, body, reply_to_id)
  values (p_id, p_project_id, v_body, p_reply_to_id)
  returning * into v_inserted;

  insert into public.project_message_attachments
    (project_id, message_id, storage_path, size_bytes, kind, mime_type, file_name, width, height)
  select p_project_id, p_id, a.path, a.size_bytes,
         coalesce(a.kind, 'image'), coalesce(a.mime_type, 'image/jpeg'),
         coalesce(a.file_name, regexp_replace(a.path, '^.*/', '')),
         a.width, a.height
    from jsonb_to_recordset(v_attachments)
      as a(path text, size_bytes int, kind text, mime_type text, file_name text, width int, height int);

  return v_inserted;
end;
$$;

revoke all on function public.create_chat_message(uuid, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.create_chat_message(uuid, uuid, text, jsonb, uuid) to authenticated;
