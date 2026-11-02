-- Реакции на сообщения чата (0035). Набор эмодзи фиксированный: CHECK в базе и
-- REACTION_EMOJI в lib/validation/chat.ts должны совпадать — это проверяет тест
-- lib/business/chat.test.ts, чтобы списки не разъехались.
--
-- Один человек может поставить на сообщение несколько РАЗНЫХ реакций, но не две
-- одинаковые: это и есть первичный ключ (message_id, user_id, emoji).

create table if not exists public.project_message_reactions (
  message_id uuid not null references public.project_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint project_message_reactions_emoji_known
    check (emoji in ('👍', '❤️', '😂', '🎉', '🔧', '👀'))
);

create index if not exists project_message_reactions_message_idx
  on public.project_message_reactions (message_id);

alter table public.project_message_reactions enable row level security;

-- Видно реакции только тех сообщений, чей проект доступен. Роль указана явно:
-- без `to authenticated` политику проверяет и аноним, у которого нет права
-- EXECUTE на project_access() — PostgREST ответил бы 401 вместо пустого списка
-- (та же ошибка, что чинила 0034).
drop policy if exists project_message_reactions_select on public.project_message_reactions;
create policy project_message_reactions_select on public.project_message_reactions
  for select to authenticated using (
    exists (
      select 1 from public.project_messages m
       where m.id = message_id
         and public.project_access(m.project_id) is not null
    )
  );

-- Ставить можно только от своего имени и только участнику проекта сообщения.
drop policy if exists project_message_reactions_insert on public.project_message_reactions;
create policy project_message_reactions_insert on public.project_message_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.project_messages m
       where m.id = message_id
         and public.project_access(m.project_id) is not null
    )
  );

-- Снять можно только свою реакцию.
drop policy if exists project_message_reactions_delete on public.project_message_reactions;
create policy project_message_reactions_delete on public.project_message_reactions
  for delete to authenticated using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.project_messages m
       where m.id = message_id
         and public.project_access(m.project_id) is not null
    )
  );

-- UPDATE-политики нет намеренно: реакцию не правят, её ставят или снимают.

-- ── Realtime ─────────────────────────────────────────────────────────────────

-- Реакции приходят тем же путём, что и сообщения: подписка на поток изменений,
-- RLS продолжает действовать и на Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'project_message_reactions'
     )
  then
    alter publication supabase_realtime add table public.project_message_reactions;
  end if;
exception
  when others then
    raise notice 'Realtime: project_message_reactions не добавлена в публикацию (%)', sqlerrm;
end;
$$;
