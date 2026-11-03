-- Упоминания в чате попадают в ленту проекта (0040).
--
-- Зачем: упоминание через «@» видно только пока открыт чат. Человек, который
-- в чат не заглядывал, о нём не узнаёт. Теперь на каждое упоминание пишется
-- событие в project_activity — его видно в «Ленте проекта».
--
-- Почему разбор в базе, а не в приложении: упоминания хранятся только текстом
-- сообщения, и разбирать их на клиенте — значит зависеть от того, открыт ли
-- чат. Триггер срабатывает один раз на вставку, независимо от читателей.
--
-- Правка сообщения новых записей не создаёт: событие — это «вас позвали»,
-- а не история текста.

-- activity-kind: chat_mention
-- Маркер выше читает юнит-тест (lib/business/activity.test.ts): он сверяет
-- словарь подписей с миграциями и должен знать про этот вид события.

create or replace function private.activity_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flat text;
  v_excerpt text;
  v_member record;
begin
  -- Быстрый выход: без «@» искать нечего.
  if position('@' in new.body) = 0 then
    return null;
  end if;

  -- Снимок текста: переводы строк схлопываем, длинное режем. В ленте строка
  -- одна, и простыня на пол-экрана там не нужна.
  v_flat := regexp_replace(btrim(new.body), '\s+', ' ', 'g');
  v_excerpt := left(v_flat, 80);
  if char_length(v_flat) > 80 then
    v_excerpt := v_excerpt || '…';
  end if;

  -- Только участники проекта: упомянуть можно лишь того, кто в проекте есть.
  -- Автора сообщения пропускаем — себе уведомление не нужно.
  for v_member in
    select pm.user_id, p.full_name
      from public.project_members pm
      join public.profiles p on p.id = pm.user_id
     where pm.project_id = new.project_id
       and pm.user_id <> new.author_id
       and p.full_name is not null
  loop
    -- «@» + имя целиком, а за именем — не буква и не цифра: участник «Иван»
    -- не должен срабатывать на «@Иванов». Спецсимволы в имени (точки в
    -- «И. И. Петров») экранируем, иначе имя с точкой совпало бы с чем угодно.
    -- Регистр не важен: в базе en_US.UTF-8, ~* работает и с кириллицей.
    if new.body ~* ('@' || regexp_replace(v_member.full_name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^[:alnum:]_]|$)')
       -- Повторная вставка того же сообщения не должна плодить события.
       and not exists (
         select 1
           from public.project_activity a
          where a.kind = 'chat_mention'
            and a.entity_id = new.id
            and a.payload->>'mentioned_user_id' = v_member.user_id::text
       )
    then
      perform private.activity_write(
        new.project_id,
        'chat_mention',
        'chat_message',
        new.id,
        jsonb_build_object(
          'message_id', new.id,
          'mentioned_user_id', v_member.user_id,
          'mentioned', v_member.full_name,
          'excerpt', v_excerpt
        )
      );
    end if;
  end loop;

  return null;
end;
$$;

comment on function private.activity_chat_mention() is
  'Пишет событие chat_mention на каждого упомянутого в сообщении участника (кроме автора).';

drop trigger if exists project_messages_activity_mention on public.project_messages;
create trigger project_messages_activity_mention
  after insert on public.project_messages
  for each row execute function private.activity_chat_mention();
