-- Документы в чате и уборка «сирот» по активности (0038).
--
-- До этого вложения были только фото: width/height NOT NULL и путь *.jpg.
-- Теперь у вложения есть вид: картинка (нужны размеры) или документ (размеров
-- нет, зато есть имя файла и mime). Расширение пути обязано совпадать с видом и
-- mime — иначе в базу можно записать «pdf», который на самом деле jpeg.
--
-- Уборка сирот: крона на хостинге нет, а платформа запрещает прямой delete из
-- storage.objects, поэтому файлы удаляет сервер через Storage API. Чтобы не
-- дёргать Storage на каждом открытии чата, право на уборку «выкупается» на
-- сутки: claim_chat_cleanup атомарно ставит отметку и говорит, можно ли сейчас.

-- ================= Вид вложения =================

alter table public.project_message_attachments
  add column if not exists kind text,
  add column if not exists mime_type text,
  add column if not exists file_name text;

-- Бэкфилл: всё, что появилось до этой миграции, — фото.
update public.project_message_attachments
   set kind = coalesce(kind, 'image'),
       mime_type = coalesce(mime_type, 'image/jpeg'),
       file_name = coalesce(file_name, regexp_replace(storage_path, '^.*/', ''))
 where kind is null or mime_type is null or file_name is null;

alter table public.project_message_attachments
  -- Вид НЕ получает default: иначе default сработает раньше BEFORE INSERT
  -- триггера, и документ (.pdf) окажется «картинкой» без размеров. Вид выводит
  -- триггер из расширения пути.
  alter column kind drop default,
  alter column kind set not null,
  alter column width drop not null,
  alter column height drop not null;

-- Старые проверки размеров и пути заменяются: у документа размеров нет вовсе,
-- а путь теперь может быть не только *.jpg. Новые тоже пересоздаются — миграция
-- должна переживать повторный прогон.
alter table public.project_message_attachments
  drop constraint if exists project_message_attachments_width_check,
  drop constraint if exists project_message_attachments_height_check,
  drop constraint if exists project_message_attachments_path_matches_message,
  drop constraint if exists project_message_attachments_kind_known,
  drop constraint if exists project_message_attachments_dimensions,
  drop constraint if exists project_message_attachments_kind_dimensions,
  drop constraint if exists project_message_attachments_mime_matches_kind;

alter table public.project_message_attachments
  add constraint project_message_attachments_kind_known
    check (kind in ('image', 'document')),
  add constraint project_message_attachments_dimensions
    check ((width is null or width > 0) and (height is null or height > 0)),
  -- У картинки размеры обязательны, у документа их быть не должно: иначе
  -- непонятно, что показывать превью-сеткой, а что карточкой файла.
  add constraint project_message_attachments_kind_dimensions
    check (
      (kind = 'image' and width is not null and height is not null)
      or (kind = 'document' and width is null and height is null)
    ),
  add constraint project_message_attachments_path_matches_message
    check (
      storage_path ~ ('^' || project_id::text || '/' || message_id::text
                      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                      || '\.(jpg|pdf|doc|docx|xls|xlsx|txt|csv)$')
    ),
  -- Расширение, mime и вид — одно и то же. `.doc$` не совпадёт с `.docx$`,
  -- поэтому порядок ветвей не важен.
  add constraint project_message_attachments_mime_matches_kind
    check (
      case kind
        when 'image' then mime_type = 'image/jpeg' and storage_path ~ '\.jpg$'
        when 'document' then (
          (storage_path ~ '\.pdf$' and mime_type = 'application/pdf')
          or (storage_path ~ '\.doc$' and mime_type = 'application/msword')
          or (storage_path ~ '\.docx$'
              and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          or (storage_path ~ '\.xls$' and mime_type = 'application/vnd.ms-excel')
          or (storage_path ~ '\.xlsx$'
              and mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          or (storage_path ~ '\.txt$' and mime_type = 'text/plain')
          or (storage_path ~ '\.csv$' and mime_type = 'text/csv')
        )
        else false
      end
    );

-- ================= Bucket: картинки и документы =================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  26214400,
  array[
    'image/jpeg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ================= Заполнение метаданных на вставке =================
-- RPC заполняет всё сам, но прямой insert (тесты, будущие пути записи) не должен
-- оставлять пустое имя файла или вид «по умолчанию» не тот: выводим из пути.

create or replace function private.fill_attachment_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.file_name := coalesce(
    nullif(btrim(new.file_name), ''),
    regexp_replace(new.storage_path, '^.*/', '')
  );

  if new.kind is null then
    new.kind := case when new.storage_path ~ '\.jpg$' then 'image' else 'document' end;
  end if;

  if new.mime_type is null then
    new.mime_type := case
      when new.storage_path ~ '\.jpg$' then 'image/jpeg'
      when new.storage_path ~ '\.pdf$' then 'application/pdf'
      when new.storage_path ~ '\.doc$' then 'application/msword'
      when new.storage_path ~ '\.docx$'
        then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when new.storage_path ~ '\.xls$' then 'application/vnd.ms-excel'
      when new.storage_path ~ '\.xlsx$'
        then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      when new.storage_path ~ '\.txt$' then 'text/plain'
      when new.storage_path ~ '\.csv$' then 'text/csv'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists project_message_attachments_fill_metadata
  on public.project_message_attachments;
create trigger project_message_attachments_fill_metadata
  before insert on public.project_message_attachments
  for each row execute function private.fill_attachment_metadata();

-- ================= RPC: сообщение с вложениями =================
-- Поля kind/mime_type/file_name необязательны для совместимости со старыми
-- вызовами: без них вложение считается фото, как было до 0038.

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

  insert into public.project_messages (id, project_id, body)
  values (p_id, p_project_id, v_body)
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

revoke all on function public.create_chat_message(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.create_chat_message(uuid, uuid, text, jsonb) to authenticated;

-- ================= Право на уборку сирот =================
-- Отметка хранится в private: это служебное состояние, а не данные проекта.

create table if not exists private.cleanup_runs (
  job text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  ran_at timestamptz not null default now(),
  primary key (job, project_id)
);

-- true — уборку можно запускать (и право уже занято); false — уже запускали
-- меньше суток назад или у вызывающего нет прав на проект.
-- Вставка с on conflict where — одна атомарная операция: два одновременных
-- вызова не получат true оба.
create or replace function public.claim_chat_cleanup(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  if not public.project_can_edit(p_project_id) then
    return false;
  end if;

  insert into private.cleanup_runs as c (job, project_id, ran_at)
  values ('chat-orphans', p_project_id, now())
  on conflict (job, project_id) do update
     set ran_at = now()
     where c.ran_at < now() - interval '1 day'
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- Уборка упала — снимаем отметку, чтобы не ждать сутки.
create or replace function public.release_chat_cleanup(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.project_can_edit(p_project_id) then
    return;
  end if;

  delete from private.cleanup_runs
   where job = 'chat-orphans' and project_id = p_project_id;
end;
$$;

revoke all on function public.claim_chat_cleanup(uuid) from public, anon;
revoke all on function public.release_chat_cleanup(uuid) from public, anon;
grant execute on function public.claim_chat_cleanup(uuid) to authenticated;
grant execute on function public.release_chat_cleanup(uuid) to authenticated;
