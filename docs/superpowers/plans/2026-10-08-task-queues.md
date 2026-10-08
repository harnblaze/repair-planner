# Очереди и ручной порядок текущих заявок — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Мастер расставляет заявки в «Текущих заявках» перетаскиванием и заводит свои очереди (например, «Столярные дела») — отдельные панели текущих заявок со своим ручным порядком.

**Architecture:** Миграция `0018` добавляет таблицу `task_queues` (основная очередь — `tasks.queue_id is null`), колонку `tasks.backlog_position`, триггер сброса позиции и RPC `move_backlog_task` (перестановка и перенос между очередями под advisory-блокировкой). Доска хранит панели очередей в `useOptimistic`-состоянии по ключу очереди; чистая логика перестановки вынесена в `lib/business/backlog-queues.ts`. Очереди создаются и удаляются в настройках списков, очередь заявки меняется на её странице.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL 17, RLS, plpgsql), dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`), React Hook Form + Zod, vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-08-task-queues-design.md`

## Global Constraints

- Ответы, тексты интерфейса и сообщения об ошибках — на русском; пользователю — понятные сообщения, технические детали — в `console.error`.
- RLS на каждой новой таблице; SELECT — `public.project_access(project_id) is not null`, INSERT/UPDATE/DELETE — `public.project_can_edit(project_id)`.
- Функции: `set search_path = ''`, `revoke all ... from public, anon`, `grant execute ... to authenticated`; триггерные функции — в схеме `private`.
- Имя очереди: `trim`, 1–60 символов (CHECK `char_length(btrim(name)) between 1 and 60`).
- Порядок панели очереди везде один: `backlog_position asc nulls first, created_at desc, id`.
- Позиция `p_position` — место в целевой очереди **без** перемещаемой заявки; `positionSchema` = целое 0..10 000.
- Никогда не запускать `supabase db reset`; миграции локально — `supabase migration up --local`.
- `psql` не установлен: SQL локально — `docker exec supabase_db_repair_planner psql -U postgres`.
- Работа — на ветке `feat/task-queues`. Коммиты по задачам — только если пользователь разрешил их при выборе способа выполнения; merge/push в `main` (= деплой на прод) и `supabase db push` на прод — только после отдельного явного подтверждения.
- Не трогать и не коммитить `docker-compose.yml`, `.claude/`, `HANDOFF.md`.

## Review Focus

1. **Перетаскивание из дня в панель чужой очереди** — должен быть отказ с понятной причиной, а не тихий возврат в другую очередь. Покрыто `checkDrop` в Task 5 (ручная проверка в Task 9).
2. **Сортировка в панели с открытой формой создания и пустой панелью** — бросок на пустую панель другой очереди даёт индекс 0, на свою — без хода. Покрыто `queueDropIndex` (Task 3).
3. **Удаление очереди с запланированными заявками** — они остаются в днях, а при возврате попадают в «Текущие заявки». `on delete set null (queue_id)` действует на все заявки очереди; pgTAP (Task 1) проверяет заявку из панели, запланированную — при ревью и в браузере (Task 9, п. 7: перед удалением запланировать одну заявку очереди и затем вернуть её с доски).
4. **«Только просмотр»** — ни перетаскивания, ни форм создания, ни поля «Очередь» для изменения, ни кнопок в настройках. Покрыто pgTAP (RPC и RLS, Task 1) и ручной проверкой (Task 9).
5. **Встречные переносы между двумя очередями** — блокировки берутся в порядке ключей, без взаимной блокировки. Покрыто кодом RPC (Task 1); автотеста на конкурентность нет — проверить при ревью.

---

## Структура файлов

| Файл | Что |
|---|---|
| `supabase/migrations/0018_task_queues.sql` (новый) | таблица, колонки, триггер, RPC |
| `supabase/tests/database/task-queues.test.sql` (новый) | pgTAP |
| `lib/types/database.ts` | перегенерация |
| `lib/validation/board-move.ts`, `board-move.test.ts` (новый) | `moveBacklogTaskSchema` |
| `lib/validation/task-queue.ts`, `task-queue.test.ts` (новые) | `taskQueueSchema` |
| `lib/validation/task.ts` | `createTaskSchema.queueId` |
| `lib/errors.ts` | `queue_not_found` |
| `lib/business/backlog-queues.ts`, `backlog-queues.test.ts` (новые) | ключи очередей, перенос, индекс броска |
| `app/(app)/[projectId]/board/actions.ts` | `moveBacklogTaskAction`, очередь при создании |
| `app/(app)/[projectId]/board/page.tsx` | загрузка очередей, группировка |
| `app/(app)/[projectId]/board/week-board.tsx` | панели очередей, сортировка, переносы |
| `app/(app)/[projectId]/board/create-task-form.tsx` | `queueId` |
| `app/(app)/[projectId]/tasks/actions.ts`, `tasks/create-task-form.tsx`, `tasks/page.tsx` | очередь при создании |
| `app/(app)/[projectId]/tasks/[taskId]/actions.ts`, `task-details-form.tsx`, `page.tsx` | поле «Очередь» |
| `app/(app)/[projectId]/settings/lists/actions.ts`, `page.tsx`, `create-queue-form.tsx` (новый), `queue-row.tsx` (новый) | настройки очередей |
| `docs/database.md`, `docs/architecture.md`, `docs/product-requirements.md`, `docs/roadmap.md` | документация |

---

### Task 1: База данных — миграция 0018 и pgTAP

**Files:**
- Create: `supabase/tests/database/task-queues.test.sql`
- Create: `supabase/migrations/0018_task_queues.sql`

**Interfaces:**
- Produces: таблица `public.task_queues(id, project_id, name, created_at, updated_at)`; колонки `tasks.queue_id uuid null`, `tasks.backlog_position int null`; RPC `public.move_backlog_task(p_task_id uuid, p_queue_id uuid, p_position int) returns void`, ошибки `task_not_found`, `access_denied`, `task_already_planned`, `task_closed`, `queue_not_found`.

- [ ] **Step 1: Написать pgTAP-тест**

`supabase/tests/database/task-queues.test.sql`:

```sql
-- Очереди текущих заявок и ручной порядок (0018): RLS task_queues, составной FK,
-- триггер сброса backlog_position, RPC move_backlog_task. Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(45);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'queue-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'queue-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'queue-viewer-c@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.task_queues (id, project_id, name) values
  ('d1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Столярные дела'),
  ('d1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Чужая очередь');

insert into public.tasks (id, project_id, title, created_at) values
  ('f1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T1', '2026-01-01'),
  ('f1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T2', '2026-01-02'),
  ('f1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T3', '2026-01-03'),
  ('f1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TB', '2026-01-01');

insert into public.tasks (id, project_id, title, status, completed_at, created_at) values
  ('f1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T4', 'completed', now(), '2026-01-04');

insert into public.tasks (id, project_id, title, queue_id, created_at) values
  ('f1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Q1',
   'd1000000-0000-0000-0000-00000000000a', '2026-01-06');

-- Видимый порядок панели очереди (как на доске). Создаётся в транзакции теста и
-- откатывается вместе с ней.
create function public._test_backlog(p_project uuid, p_queue uuid)
returns text[]
language sql
set search_path = ''
as $$
  select coalesce(
    array_agg(t.title order by t.backlog_position asc nulls first, t.created_at desc, t.id),
    '{}'
  )
  from public.tasks t
  where t.project_id = p_project
    and t.queue_id is not distinct from p_queue
    and t.planned_date is null
    and t.status not in ('completed', 'cancelled');
$$;
grant execute on function public._test_backlog(uuid, uuid) to authenticated;

-- ================= Структура =================

-- 1-4
select has_table('public', 'task_queues', 'task_queues exists');
select is((select relrowsecurity from pg_class where oid = 'public.task_queues'::regclass), true, 'RLS is enabled on task_queues');
select has_column('public', 'tasks', 'queue_id', 'tasks.queue_id exists');
select has_column('public', 'tasks', 'backlog_position', 'tasks.backlog_position exists');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 5. Создаёт очередь в своём проекте
select lives_ok(
  $$ insert into public.task_queues (id, project_id, name) values
     ('d1000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрика') $$,
  'owner creates a queue in own project'
);

-- 6. Видит только очереди своего проекта
select is((select count(*)::int from public.task_queues), 2, 'owner sees only own project queues');

-- 7. Не может создать очередь в чужом проекте
select throws_ok(
  $$ insert into public.task_queues (project_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Взлом') $$,
  '42501', null,
  'owner cannot create a queue in another project'
);

-- 8. project_id очереди неизменяем
select throws_ok(
  $$ update public.task_queues set project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     where id = 'd1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null,
  'queue project_id cannot be changed'
);

-- 9. Переименование
select lives_ok(
  $$ update public.task_queues set name = 'Электрика и свет' where id = 'd1000000-0000-0000-0000-0000000000e1' $$,
  'owner renames a queue'
);

-- 10. Очередь чужого проекта отвергает составной FK
select throws_ok(
  $$ update public.tasks set queue_id = 'd1000000-0000-0000-0000-00000000000b'
     where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'task cannot reference a queue of another project'
);

-- 11. Нерасставленные заявки — новые сверху
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T2', 'T1'],
  'unranked tasks are ordered newest first'
);

-- 12-14. Перестановка материализует видимый порядок
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', null, 0) $$,
  'owner moves T1 to the top'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T1', 'T3', 'T2'],
  'T1 is first, the rest keep their visible order'
);
select is(
  (select count(*)::int from public.tasks
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and queue_id is null
      and planned_date is null and status not in ('completed', 'cancelled') and backlog_position is null),
  0,
  'every task of the main queue got a position'
);

-- 15-18. Позиция зажимается в границы списка
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000003', null, 99) $$,
  'position above the list is accepted'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T1', 'T2', 'T3'],
  'position above the list puts the task last'
);
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000003', null, -5) $$,
  'negative position is accepted'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T1', 'T2'],
  'negative position puts the task first'
);

-- 19-20. Закрытые заявки и чужой проект не перенумеровываются
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000004'),
  null::int,
  'completed task keeps a null position'
);
select is(
  (select count(*)::int from public.tasks where id = 'f1000000-0000-0000-0000-00000000000b'),
  0,
  'task of another project is invisible to the owner'
);

-- 21-25. Перенос в другую очередь и перестановка внутри неё
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 0) $$,
  'owner moves T1 into the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-00000000000a'),
  array['T1', 'Q1'],
  'T1 is first in the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null),
  array['T3', 'T2'],
  'the main queue keeps its order without T1'
);
select lives_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 5) $$,
  'owner reorders inside the carpentry queue'
);
select is(
  public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-00000000000a'),
  array['Q1', 'T1'],
  'T1 is last in the carpentry queue'
);

-- 26-27. Отказы
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000b', 0) $$,
  'P0001', 'queue_not_found',
  'queue of another project is rejected'
);
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000004', null, 0) $$,
  'P0001', 'task_closed',
  'closed task cannot be reordered'
);

-- ================= Владелец B =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 28-29
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'task_not_found',
  'task of another project is not found'
);
select is((select count(*)::int from public.task_queues), 1, 'owner B sees only own queue');

-- ================= Viewer C в проекте A =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 30-32
select is((select count(*)::int from public.task_queues), 2, 'viewer sees queues of the project');
select throws_ok(
  $$ insert into public.task_queues (project_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Взлом') $$,
  '42501', null,
  'viewer cannot create a queue'
);
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'access_denied',
  'viewer cannot reorder'
);

-- Под RLS эти операции молча затрагивают ноль строк — результат проверяется ниже.
update public.task_queues set name = 'Взлом' where id = 'd1000000-0000-0000-0000-00000000000a';
delete from public.task_queues where id = 'd1000000-0000-0000-0000-0000000000e1';

reset role;

-- 33-34
select is(
  (select name from public.task_queues where id = 'd1000000-0000-0000-0000-00000000000a'),
  'Столярные дела',
  'viewer cannot rename a queue'
);
select is(
  (select count(*)::int from public.task_queues where id = 'd1000000-0000-0000-0000-0000000000e1'),
  1,
  'viewer cannot delete a queue'
);

-- ================= Триггер сброса позиции (как postgres) =================

-- 35. Планирование на день обнуляет позицию
insert into public.task_schedule (project_id, task_id, work_date, position) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1000000-0000-0000-0000-000000000002', '2026-10-12', 0);
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000002'),
  null::int,
  'planning a task resets its position'
);

-- 36. Запланированную заявку нельзя переставить в панели
update public.tasks set backlog_position = 7 where id = 'f1000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;
select throws_ok(
  $$ select public.move_backlog_task('f1000000-0000-0000-0000-000000000002', null, 0) $$,
  'P0001', 'task_already_planned',
  'planned task cannot be reordered'
);
reset role;

-- 37. Возврат с доски (последний день отложен) обнуляет позицию
update public.task_schedule set postponed = true where task_id = 'f1000000-0000-0000-0000-000000000002';
select ok(
  (select planned_date is null and backlog_position is null
     from public.tasks where id = 'f1000000-0000-0000-0000-000000000002'),
  'returning a task to the backlog resets its position'
);

-- 38. Новая заявка — первой в своей очереди
insert into public.tasks (id, project_id, title) values
  ('f1000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'T7');
select is(
  (public._test_backlog('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null))[1],
  'T7',
  'a new task is first in its queue'
);

-- 39. Смена статуса между открытыми сохраняет позицию
update public.tasks set status = 'in_progress' where id = 'f1000000-0000-0000-0000-000000000003';
select isnt(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000003'),
  null::int,
  'changing status between open statuses keeps the position'
);

-- 40. Завершение и переоткрытие обнуляют позицию
update public.tasks set status = 'completed', completed_at = now() where id = 'f1000000-0000-0000-0000-000000000003';
update public.tasks set status = 'new', completed_at = null where id = 'f1000000-0000-0000-0000-000000000003';
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000003'),
  null::int,
  'reopening a closed task resets its position'
);

-- 41. Смена очереди обнуляет позицию
update public.tasks set queue_id = 'd1000000-0000-0000-0000-0000000000e1' where id = 'f1000000-0000-0000-0000-000000000006';
select is(
  (select backlog_position from public.tasks where id = 'f1000000-0000-0000-0000-000000000006'),
  null::int,
  'changing the queue resets the position'
);

-- 42-43. Удаление очереди переводит её заявки в основную
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;
select lives_ok(
  $$ delete from public.task_queues where id = 'd1000000-0000-0000-0000-00000000000a' $$,
  'owner deletes a queue'
);
reset role;
select ok(
  (select queue_id is null and backlog_position is null and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     from public.tasks where id = 'f1000000-0000-0000-0000-000000000001'),
  'tasks of a deleted queue move to the main queue'
);

-- 44-45. Права на функцию
select ok(
  not has_function_privilege('anon', 'public.move_backlog_task(uuid, uuid, int)', 'execute'),
  'anon cannot execute move_backlog_task'
);
select ok(
  has_function_privilege('authenticated', 'public.move_backlog_task(uuid, uuid, int)', 'execute'),
  'authenticated can execute move_backlog_task'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `supabase test db 2>&1 | tail -20`
Expected: `task-queues.test.sql` FAIL — ошибка на фикстуре `relation "public.task_queues" does not exist`; `rls.test.sql` и `attachments.test.sql` — ok.

- [ ] **Step 3: Написать миграцию**

`supabase/migrations/0018_task_queues.sql`:

```sql
-- Очереди текущих заявок и ручной порядок в них
-- (docs/superpowers/specs/2026-10-08-task-queues-design.md).
-- Основная очередь «Текущие заявки» — tasks.queue_id is null, строки у неё нет.

-- ================= task_queues =================

create table if not exists public.task_queues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists task_queues_project_idx on public.task_queues (project_id, created_at);

drop trigger if exists task_queues_set_updated_at on public.task_queues;
create trigger task_queues_set_updated_at
  before update on public.task_queues
  for each row execute function public.set_updated_at();

alter table public.task_queues enable row level security;

drop policy if exists "task_queues_select" on public.task_queues;
create policy "task_queues_select" on public.task_queues for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "task_queues_insert" on public.task_queues;
create policy "task_queues_insert" on public.task_queues for insert to authenticated
  with check (public.project_can_edit(project_id));

drop policy if exists "task_queues_update" on public.task_queues;
create policy "task_queues_update" on public.task_queues for update to authenticated
  using (public.project_can_edit(project_id))
  with check (public.project_can_edit(project_id));

drop policy if exists "task_queues_delete" on public.task_queues;
create policy "task_queues_delete" on public.task_queues for delete to authenticated
  using (public.project_can_edit(project_id));

-- project_id неизменяем: право UPDATE только на name. Отозвать право на одну
-- колонку при праве на всю таблицу (Supabase выдаёт его по умолчанию) нельзя.
revoke update on public.task_queues from authenticated, anon;
grant update (name) on public.task_queues to authenticated;

-- ================= tasks: очередь и место в ней =================

alter table public.tasks add column if not exists queue_id uuid;
alter table public.tasks add column if not exists backlog_position int;

comment on column public.tasks.queue_id is
  'Очередь текущих заявок; null — основная («Текущие заявки»)';
comment on column public.tasks.backlog_position is
  'Место в панели очереди; null — ещё не расставляли: такие идут первыми, новые сверху';

-- Составной FK, как у category_id (docs/database.md §4): очередь чужого проекта
-- отвергает сам PostgreSQL. При удалении очереди заявки уходят в основную.
alter table public.tasks drop constraint if exists tasks_queue_fk;
alter table public.tasks
  add constraint tasks_queue_fk
    foreign key (queue_id, project_id) references public.task_queues (id, project_id)
    on delete set null (queue_id);

-- Для каскада при удалении очереди.
create index if not exists tasks_queue_idx on public.tasks (queue_id) where queue_id is not null;

-- Заявка встаёт наверх своей очереди, когда появляется в панели заново: новая,
-- вернулась с доски, очищена дата, переоткрыта, сменила очередь.
create or replace function private.reset_task_backlog_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.backlog_position := null;
  elsif new.planned_date is distinct from old.planned_date
     or new.queue_id is distinct from old.queue_id
     or (new.status in ('completed', 'cancelled')) <> (old.status in ('completed', 'cancelled')) then
    new.backlog_position := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_backlog_position on public.tasks;
create trigger tasks_reset_backlog_position
  before insert or update of planned_date, status, queue_id on public.tasks
  for each row execute function private.reset_task_backlog_position();

-- ================= RPC: порядок и перенос между очередями =================

-- p_queue_id — целевая очередь (null — основная); p_position — место в ней без
-- перемещаемой заявки. Образец — move_board_item (0008).
create or replace function public.move_backlog_task(p_task_id uuid, p_queue_id uuid, p_position int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_from_key text;
  v_to_key text;
  v_count int;
  v_position int;
begin
  select t.id, t.project_id, t.status, t.planned_date, t.queue_id
    into v_task
    from public.tasks t
    where t.id = p_task_id;

  if not found then
    raise exception 'task_not_found';
  end if;

  -- Явно: при security invoker UPDATE без права просто изменил бы ноль строк.
  if not public.project_can_edit(v_task.project_id) then
    raise exception 'access_denied';
  end if;

  if v_task.planned_date is not null then
    raise exception 'task_already_planned';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;

  if p_queue_id is not null and not exists (
    select 1 from public.task_queues q
      where q.id = p_queue_id and q.project_id = v_task.project_id
  ) then
    raise exception 'queue_not_found';
  end if;

  -- Обе очереди и в порядке ключей: параллельная перестановка исходной очереди
  -- не запишет позицию ушедшей заявке, встречные переносы не заблокируют друг друга.
  v_from_key := coalesce(v_task.queue_id::text, '');
  v_to_key := coalesce(p_queue_id::text, '');
  perform private.lock_board_container('queue', v_task.project_id, least(v_from_key, v_to_key));
  if v_from_key <> v_to_key then
    perform private.lock_board_container('queue', v_task.project_id, greatest(v_from_key, v_to_key));
    -- Триггер tasks_reset_backlog_position обнулит позицию; её задаёт перенумерация ниже.
    update public.tasks set queue_id = p_queue_id where id = p_task_id;
  end if;

  select count(*) into v_count
    from public.tasks t
    where t.project_id = v_task.project_id
      and t.queue_id is not distinct from p_queue_id
      and t.planned_date is null
      and t.status not in ('completed', 'cancelled')
      and t.id <> p_task_id;

  v_position := least(greatest(coalesce(p_position, v_count), 0), v_count);

  with ordered as (
    select t.id,
           (row_number() over (
              order by t.backlog_position asc nulls first, t.created_at desc, t.id
            ) - 1)::int as rn
      from public.tasks t
      where t.project_id = v_task.project_id
        and t.queue_id is not distinct from p_queue_id
        and t.planned_date is null
        and t.status not in ('completed', 'cancelled')
        and t.id <> p_task_id
  ),
  target as (
    select id, case when rn < v_position then rn else rn + 1 end as new_position from ordered
    union all
    select p_task_id, v_position
  )
  update public.tasks t
    set backlog_position = target.new_position
    from target
    where t.id = target.id and t.backlog_position is distinct from target.new_position;
end;
$$;

revoke all on function public.move_backlog_task(uuid, uuid, int) from public, anon;
grant execute on function public.move_backlog_task(uuid, uuid, int) to authenticated;
```

- [ ] **Step 4: Применить миграцию и запустить тесты**

Run: `supabase migration up --local && supabase test db 2>&1 | tail -20`
Expected: миграция `0018_task_queues.sql` применена; все три файла ok, `task-queues.test.sql .. ok` (45 тестов), итого 215.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0018_task_queues.sql supabase/tests/database/task-queues.test.sql
git commit -m "feat(db): очереди текущих заявок и ручной порядок в них"
```

---

### Task 2: Типы, валидация, сообщения об ошибках

**Files:**
- Modify: `lib/types/database.ts` (перегенерация)
- Modify: `lib/validation/board-move.ts`
- Create: `lib/validation/board-move.test.ts`
- Create: `lib/validation/task-queue.ts`, `lib/validation/task-queue.test.ts`
- Modify: `lib/validation/task.ts`
- Modify: `lib/errors.ts`

**Interfaces:**
- Consumes: схема БД из Task 1.
- Produces: `moveBacklogTaskSchema` (`{ taskId: string; queueId: string | null; position: number }`), тип `MoveBacklogTaskInput`; `taskQueueSchema` (`{ name: string }`), `TASK_QUEUE_NAME_MAX = 60`, тип `TaskQueueInput`; `createTaskSchema` с `queueId?: string`; ключ `queue_not_found` в `BOARD_MOVE_ERROR_MESSAGES`.

- [ ] **Step 1: Перегенерировать типы**

Run: `supabase gen types typescript --local > lib/types/database.ts && grep -c "task_queues\|move_backlog_task\|backlog_position" lib/types/database.ts`
Expected: число > 0; `git diff --stat lib/types/database.ts` — только добавления, связанные с 0018.

- [ ] **Step 2: Написать тесты валидации**

`lib/validation/board-move.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { moveBacklogTaskSchema } from "./board-move";

const TASK = "f1000000-0000-0000-0000-000000000001";
const QUEUE = "d1000000-0000-0000-0000-00000000000a";

describe("moveBacklogTaskSchema", () => {
  it("принимает основную очередь (null)", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: null, position: 0 }).success).toBe(true);
  });

  it("принимает id очереди", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: QUEUE, position: 3 }).success).toBe(true);
  });

  it("отклоняет ключ вместо id очереди", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: "main", position: 0 }).success).toBe(false);
  });

  it("отклоняет отрицательную, дробную и слишком большую позицию", () => {
    for (const position of [-1, 1.5, 10_001]) {
      expect(moveBacklogTaskSchema.safeParse({ taskId: TASK, queueId: null, position }).success).toBe(false);
    }
  });

  it("отклоняет не-uuid заявки", () => {
    expect(moveBacklogTaskSchema.safeParse({ taskId: "1", queueId: null, position: 0 }).success).toBe(false);
  });
});
```

`lib/validation/task-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { taskQueueSchema } from "./task-queue";

describe("taskQueueSchema", () => {
  it("обрезает пробелы", () => {
    expect(taskQueueSchema.parse({ name: "  Столярные дела  " })).toEqual({ name: "Столярные дела" });
  });

  it("отклоняет пустое имя и имя из пробелов", () => {
    expect(taskQueueSchema.safeParse({ name: "" }).success).toBe(false);
    expect(taskQueueSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("принимает 60 символов и отклоняет 61", () => {
    expect(taskQueueSchema.safeParse({ name: "я".repeat(60) }).success).toBe(true);
    expect(taskQueueSchema.safeParse({ name: "я".repeat(61) }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падают**

Run: `npx vitest run lib/validation/board-move.test.ts lib/validation/task-queue.test.ts`
Expected: FAIL — `moveBacklogTaskSchema` не экспортируется; модуль `./task-queue` не найден.

- [ ] **Step 4: Реализовать**

В `lib/validation/board-move.ts` после `moveBoardListSchema`:

```ts
// queueId: null — основная очередь «Текущие заявки» (supabase/migrations/0018).
export const moveBacklogTaskSchema = z.object({
  taskId: idSchema,
  queueId: idSchema.nullable(),
  position: positionSchema,
});
```

и в конце файла:

```ts
export type MoveBacklogTaskInput = z.infer<typeof moveBacklogTaskSchema>;
```

`lib/validation/task-queue.ts`:

```ts
import { z } from "zod";

// Лимит совпадает с CHECK task_queues.name (supabase/migrations/0018).
export const TASK_QUEUE_NAME_MAX = 60;

export const taskQueueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Введите название")
    .max(TASK_QUEUE_NAME_MAX, "Название слишком длинное"),
});

export type TaskQueueInput = z.infer<typeof taskQueueSchema>;
```

В `lib/validation/task.ts` — `createTaskSchema`:

```ts
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Введите название заявки").max(300, "Слишком длинно"),
  categoryId: z.string().trim().optional(),
  // Очередь чужого проекта отвергает составной FK tasks_queue_fk (0018).
  queueId: z.string().trim().optional(),
});
```

В `lib/errors.ts` — в `BOARD_MOVE_ERROR_MESSAGES` после `list_not_found`:

```ts
  queue_not_found: "Очередь не найдена. Обновите страницу.",
```

- [ ] **Step 5: Запустить тесты и tsc**

Run: `npx vitest run lib/validation && npx tsc --noEmit`
Expected: PASS, tsc без ошибок.

- [ ] **Step 6: Commit**

```bash
git add lib/types/database.ts lib/validation lib/errors.ts
git commit -m "feat: типы и валидация очередей заявок"
```

---

### Task 3: Чистая логика панелей очередей

**Files:**
- Create: `lib/business/backlog-queues.ts`
- Create: `lib/business/backlog-queues.test.ts`

**Interfaces:**
- Produces:
  - `MAIN_QUEUE_KEY = "main"`;
  - `queueKey(queueId: string | null): string`;
  - `queueIdOf(key: string): string | null`;
  - `moveTaskBetweenQueues<T extends { id: string; queueId: string | null }>(queues: Record<string, T[]>, taskId: string, fromKey: string, toKey: string, index: number): Record<string, T[]>`;
  - `queueDropIndex(target: { id: string }[], taskId: string, overTaskId: string | null, below: boolean): number`.

- [ ] **Step 1: Написать тесты**

`lib/business/backlog-queues.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MAIN_QUEUE_KEY,
  moveTaskBetweenQueues,
  queueDropIndex,
  queueIdOf,
  queueKey,
} from "./backlog-queues";

type T = { id: string; queueId: string | null };
const task = (id: string, queueId: string | null = null): T => ({ id, queueId });
const ids = (list: T[] | undefined) => (list ?? []).map((t) => t.id);

describe("queueKey / queueIdOf", () => {
  it("основная очередь — ключ main и обратно null", () => {
    expect(queueKey(null)).toBe(MAIN_QUEUE_KEY);
    expect(queueIdOf(MAIN_QUEUE_KEY)).toBeNull();
  });

  it("дополнительная очередь — ключ равен id", () => {
    expect(queueKey("q1")).toBe("q1");
    expect(queueIdOf("q1")).toBe("q1");
  });
});

describe("moveTaskBetweenQueues", () => {
  const main = [task("a"), task("b"), task("c")];

  it("внутри очереди: индекс — место без перемещаемой заявки", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "c", "main", "main", 0).main)).toEqual(["c", "a", "b"]);
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "main", 2).main)).toEqual(["b", "c", "a"]);
  });

  it("в другую очередь: убирает из исходной, вставляет в целевую и меняет queueId", () => {
    const result = moveTaskBetweenQueues({ main, q1: [task("x", "q1")] }, "a", "main", "q1", 0);
    expect(ids(result.main)).toEqual(["b", "c"]);
    expect(ids(result.q1)).toEqual(["a", "x"]);
    expect(result.q1[0].queueId).toBe("q1");
  });

  it("в основную очередь — queueId становится null", () => {
    const result = moveTaskBetweenQueues({ main, q1: [task("x", "q1")] }, "x", "q1", "main", 1);
    expect(ids(result.main)).toEqual(["a", "x", "b", "c"]);
    expect(result.main[1].queueId).toBeNull();
    expect(ids(result.q1)).toEqual([]);
  });

  it("в пустую очередь, которой ещё нет в состоянии", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "q2", 0).q2)).toEqual(["a"]);
  });

  it("зажимает индекс в границы списка", () => {
    expect(ids(moveTaskBetweenQueues({ main }, "a", "main", "main", 99).main)).toEqual(["b", "c", "a"]);
    expect(ids(moveTaskBetweenQueues({ main }, "c", "main", "main", -3).main)).toEqual(["c", "a", "b"]);
  });

  it("неизвестная заявка — состояние не меняется", () => {
    const queues = { main };
    expect(moveTaskBetweenQueues(queues, "zzz", "main", "main", 0)).toBe(queues);
  });
});

describe("queueDropIndex", () => {
  const list = [task("a"), task("b"), task("c")];

  it("своя панель, курсор над строкой — индекс этой строки", () => {
    expect(queueDropIndex(list, "a", "c", false)).toBe(2);
    expect(queueDropIndex(list, "c", "a", true)).toBe(0);
  });

  it("своя панель, курсор над самой панелью — в конец", () => {
    expect(queueDropIndex(list, "a", null, false)).toBe(2);
  });

  it("чужая панель — перед строкой или после неё", () => {
    expect(queueDropIndex(list, "x", "b", false)).toBe(1);
    expect(queueDropIndex(list, "x", "b", true)).toBe(2);
  });

  it("чужая панель, курсор над панелью — в конец; пустая панель — 0", () => {
    expect(queueDropIndex(list, "x", null, false)).toBe(3);
    expect(queueDropIndex([], "x", null, false)).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run lib/business/backlog-queues.test.ts`
Expected: FAIL — модуль `./backlog-queues` не найден.

- [ ] **Step 3: Реализовать**

`lib/business/backlog-queues.ts`:

```ts
// Панели очередей текущих заявок на доске (docs/superpowers/specs/2026-10-08-task-queues-design.md).
// Основная очередь «Текущие заявки» — queue_id null; на клиенте у неё ключ MAIN_QUEUE_KEY.
// Окончательный порядок задаёт RPC move_backlog_task (supabase/migrations/0018),
// здесь — тот же расчёт для оптимистичного обновления.

export const MAIN_QUEUE_KEY = "main";

export function queueKey(queueId: string | null): string {
  return queueId ?? MAIN_QUEUE_KEY;
}

export function queueIdOf(key: string): string | null {
  return key === MAIN_QUEUE_KEY ? null : key;
}

/**
 * Переносит заявку внутри очереди или в другую. index — место в целевой очереди
 * без перемещаемой заявки (как p_position у RPC), зажимается в границы.
 */
export function moveTaskBetweenQueues<T extends { id: string; queueId: string | null }>(
  queues: Record<string, T[]>,
  taskId: string,
  fromKey: string,
  toKey: string,
  index: number,
): Record<string, T[]> {
  const task = queues[fromKey]?.find((t) => t.id === taskId);
  if (!task) return queues;

  const next = { ...queues, [fromKey]: queues[fromKey].filter((t) => t.id !== taskId) };
  const target = [...(next[toKey] ?? [])];
  const at = Math.min(Math.max(index, 0), target.length);
  target.splice(at, 0, { ...task, queueId: queueIdOf(toKey) });
  next[toKey] = target;
  return next;
}

/**
 * Место броска в панели очереди. В своей панели — индекс строки под курсором
 * (как arrayMove), над самой панелью — последнее место. В чужой — перед строкой
 * под курсором или после неё, если перетаскиваемая карточка ниже её середины;
 * над самой панелью — в конец.
 */
export function queueDropIndex(
  target: { id: string }[],
  taskId: string,
  overTaskId: string | null,
  below: boolean,
): number {
  const overIndex = overTaskId ? target.findIndex((t) => t.id === overTaskId) : -1;
  if (target.some((t) => t.id === taskId)) {
    return overIndex === -1 ? target.length - 1 : overIndex;
  }
  return overIndex === -1 ? target.length : overIndex + (below ? 1 : 0);
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run lib/business/backlog-queues.test.ts`
Expected: PASS (13 тестов).

- [ ] **Step 5: Commit**

```bash
git add lib/business/backlog-queues.ts lib/business/backlog-queues.test.ts
git commit -m "feat: логика перестановки в панелях очередей"
```

---

### Task 4: Серверные действия

**Files:**
- Modify: `app/(app)/[projectId]/board/actions.ts`
- Modify: `app/(app)/[projectId]/tasks/actions.ts`
- Modify: `app/(app)/[projectId]/tasks/[taskId]/actions.ts`
- Modify: `app/(app)/[projectId]/settings/lists/actions.ts`

**Interfaces:**
- Consumes: `moveBacklogTaskSchema`, `MoveBacklogTaskInput`, `taskQueueSchema`, `TaskQueueInput`, `createTaskSchema.queueId` (Task 2); RPC `move_backlog_task` (Task 1).
- Produces:
  - `moveBacklogTaskAction(projectId: string, input: MoveBacklogTaskInput): Promise<ActionResult>`;
  - `updateTaskQueueAction(projectId: string, taskId: string, queueId: string | null): Promise<ActionResult>`;
  - `createTaskQueueAction(projectId: string, input: TaskQueueInput)`, `renameTaskQueueAction(projectId: string, queueId: string, input: TaskQueueInput)`, `deleteTaskQueueAction(projectId: string, queueId: string)` — все `Promise<ActionResult>`;
  - `createTaskFromBoardAction` и `createTaskAction` сохраняют `queue_id`.

Действия — тонкая обёртка над RLS/RPC, отдельных юнит-тестов у них в проекте нет; поведение проверяет pgTAP (Task 1) и браузер (Task 9). Проверка задачи — `tsc` и `eslint`.

- [ ] **Step 1: Доска — `board/actions.ts`**

В импорт из `@/lib/validation/board-move` добавить `moveBacklogTaskSchema` и `type MoveBacklogTaskInput`.

В `createTaskFromBoardAction` в `insert` добавить строку после `category_id`:

```ts
    queue_id: parsed.data.queueId || null,
```

В конец файла:

```ts
// Перестановка в панели очереди и перенос между очередями (supabase/migrations/0018).
export async function moveBacklogTaskAction(
  projectId: string,
  input: MoveBacklogTaskInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = moveBacklogTaskSchema.safeParse(input);
  if (!parsed.success) return INVALID_MOVE;

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_backlog_task", {
    p_task_id: parsed.data.taskId,
    // Сгенерированный тип RPC не допускает null, хотя функция его принимает.
    p_queue_id: parsed.data.queueId as string,
    p_position: parsed.data.position,
  });

  if (error) {
    console.error("moveBacklogTaskAction:", error);
    return { ok: false, error: mapBoardMoveError(error.message) };
  }

  revalidateBoard(projectId);
  return { ok: true };
}
```

Примечание для исполнителя: если в сгенерированном `lib/types/database.ts` у `move_backlog_task` аргумент `p_queue_id` уже `string | null` — приведение `as string` и комментарий убрать.

- [ ] **Step 2: Страница «Заявки» — `tasks/actions.ts`**

В `createTaskAction` в `insert` после `category_id`:

```ts
      queue_id: parsed.data.queueId || null,
```

- [ ] **Step 3: Страница заявки — `tasks/[taskId]/actions.ts`**

После `updateTaskCategoryAction`:

```ts
// Смена очереди — обычный UPDATE под RLS: очередь чужого проекта отвергает
// составной FK tasks_queue_fk, позицию в очереди сбрасывает триггер (0018).
export async function updateTaskQueueAction(
  projectId: string,
  taskId: string,
  queueId: string | null,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ queue_id: queueId || null })
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("updateTaskQueueAction:", error);
    return { ok: false, error: "Не удалось сменить очередь. Обновите страницу и попробуйте ещё раз." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Заявка не найдена." };
  }

  revalidateTask(projectId, taskId);
  return { ok: true };
}
```

- [ ] **Step 4: Настройки — `settings/lists/actions.ts`**

Импорт: `import { taskQueueSchema, type TaskQueueInput } from "@/lib/validation/task-queue";`

Обновить комментарий в начале файла (после существующего абзаца):

```ts
// Очереди текущих заявок (task_queues, 0018) — здесь же: основная очередь
// строки не имеет, удаляются и переименовываются только дополнительные.
```

В `revalidateLists` добавить `revalidatePath(`/${projectId}/tasks`);` (имя очереди видно на странице заявки и в форме создания).

В конец файла:

```ts
const QUEUE_NOT_FOUND: ActionResult = { ok: false, error: "Очередь не найдена. Обновите страницу." };

export async function createTaskQueueAction(
  projectId: string,
  input: TaskQueueInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskQueueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_queues")
    .insert({ project_id: projectId, name: parsed.data.name });

  if (error) {
    console.error("createTaskQueueAction:", error);
    return { ok: false, error: "Не удалось создать очередь. Попробуйте ещё раз." };
  }

  revalidateLists(projectId);
  return { ok: true };
}

export async function renameTaskQueueAction(
  projectId: string,
  queueId: string,
  input: TaskQueueInput,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const parsed = taskQueueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Проверьте правильность заполнения формы.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  if (!idSchema.safeParse(queueId).success) return QUEUE_NOT_FOUND;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_queues")
    .update({ name: parsed.data.name })
    .eq("id", queueId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("renameTaskQueueAction:", error);
    return { ok: false, error: "Не удалось переименовать очередь. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return QUEUE_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}

export async function deleteTaskQueueAction(
  projectId: string,
  queueId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!idSchema.safeParse(queueId).success) return QUEUE_NOT_FOUND;

  const supabase = await createClient();
  // Заявки очереди переходят в основную (tasks_queue_fk on delete set null).
  const { data, error } = await supabase
    .from("task_queues")
    .delete()
    .eq("id", queueId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("deleteTaskQueueAction:", error);
    return { ok: false, error: "Не удалось удалить очередь. Попробуйте ещё раз." };
  }
  if (!data || data.length === 0) return QUEUE_NOT_FOUND;

  revalidateLists(projectId);
  return { ok: true };
}
```

Примечание: `.update({ name }).select("id")` под правом `update (name)` возвращает строки — `select` требует право SELECT, которое есть.

- [ ] **Step 5: Проверить**

Run: `npx tsc --noEmit && npx eslint "app/(app)/[projectId]/board/actions.ts" "app/(app)/[projectId]/tasks" "app/(app)/[projectId]/settings/lists"`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/[projectId]/board/actions.ts" "app/(app)/[projectId]/tasks/actions.ts" "app/(app)/[projectId]/tasks/[taskId]/actions.ts" "app/(app)/[projectId]/settings/lists/actions.ts"
git commit -m "feat: серверные действия очередей и порядка заявок"
```

---

### Task 5: Доска — панели очередей и сортировка

**Files:**
- Modify: `app/(app)/[projectId]/board/page.tsx`
- Modify: `app/(app)/[projectId]/board/week-board.tsx`
- Modify: `app/(app)/[projectId]/board/create-task-form.tsx`

**Interfaces:**
- Consumes: `queueKey`, `queueIdOf`, `moveTaskBetweenQueues`, `queueDropIndex` (Task 3); `moveBacklogTaskAction` (Task 4).
- Produces: `WeekBoard` проп `queues: BoardQueue[]` вместо `backlog`; типы `DayTask`, `BacklogTask` с `queueId: string | null`; `BoardQueue = { id: string | null; name: string; tasks: BacklogTask[] }`; `CreateTaskForm` проп `queueId: string | null`.

Компоненты доски покрыты логикой Task 3 и браузерной проверкой Task 9; здесь — tsc, eslint, build.

- [ ] **Step 1: `create-task-form.tsx` — очередь при создании**

Добавить проп и передать в действие:

```tsx
export function CreateTaskForm({
  projectId,
  queueId,
  categories,
}: {
  projectId: string;
  /** Очередь панели; null — «Текущие заявки». */
  queueId: string | null;
  categories: Category[];
}) {
```

```tsx
      const result = await createTaskFromBoardAction(projectId, { ...data, queueId: queueId ?? undefined });
```

- [ ] **Step 2: `page.tsx` — загрузка очередей и группировка**

В `Promise.all` добавить запрос (после `boardItems`) и деструктурировать как `{ data: taskQueues }`:

```ts
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
```

Запрос заявок панелей: в `select` добавить `queue_id`, сортировку заменить:

```ts
      .select(
        "id, title, status, queue_id, categories(name), task_executors(executors(name)), task_schedule(work_date, postponed)",
      )
      .eq("project_id", projectId)
      .is("planned_date", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      // Ручной порядок; нерасставленные (null) — первыми, новые сверху (0018).
      .order("backlog_position", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
```

Запрос дней: в `tasks(...)` добавить `queue_id`:

```ts
        "work_date, position, tasks(id, title, status, planned_date, queue_id, categories(name), task_executors(executors(name)), task_schedule(work_date, postponed))",
```

Вместо `const backlog: BacklogTask[] = ...`:

```ts
  // Панели очередей: «Текущие заявки» (queue_id null), затем очереди проекта.
  const queues: BoardQueue[] = [
    { id: null, name: "Текущие заявки", tasks: [] },
    ...(taskQueues ?? []).map((q) => ({ id: q.id, name: q.name, tasks: [] as BacklogTask[] })),
  ];
  const queueById = new Map(queues.map((q) => [q.id, q]));
  for (const t of backlogTasks ?? []) {
    // Очередь могли удалить между запросами — тогда заявка в основной.
    const queue = queueById.get(t.queue_id) ?? queues[0];
    queue.tasks.push({
      id: t.id,
      title: t.title,
      status: t.status,
      categoryName: t.categories?.name ?? null,
      executorNames: toExecutorNames(t.task_executors),
      lastWorkDate: lastWorkDate(toScheduleDays(t.task_schedule)),
      queueId: queue.id,
    });
  }
```

В `list.push({...})` дней добавить `queueId: row.tasks.queue_id,`.

Импорт: `import { WeekBoard, type BacklogTask, type BoardQueue, type DayTask } from "./week-board";`. В `<WeekBoard>` заменить `backlog={backlog}` на `queues={queues}`.

- [ ] **Step 3: `week-board.tsx` — состояние и ходы**

Импорты: из `@dnd-kit/core` убрать `useDraggable`; добавить

```ts
import {
  moveTaskBetweenQueues,
  queueDropIndex,
  queueIdOf,
  queueKey,
} from "@/lib/business/backlog-queues";
```

и `moveBacklogTaskAction` в импорт из `./actions`.

Заменить комментарий-шапку, типы, `BACKLOG`, `BoardState`, `DragData`, `Move` (строки 49–69):

```ts
// Неделя доски и панели очередей текущих заявок в одном DndContext: задачу
// можно запланировать, сменить ей день, упорядочить внутри дня или очереди,
// перенести в другую очередь и вернуть с доски. Правила —
// lib/business/task-planning.ts и lib/business/backlog-queues.ts, окончательная
// проверка — RPC supabase/migrations/0008, 0018. Интерфейс обновляется сразу
// (useOptimistic); при ошибке сервера состояние само возвращается к данным сервера.

export type DayTask = BoardTask & { canChangeDay: boolean; queueId: string | null };
export type BacklogTask = BoardTask & { lastWorkDate: string | null; queueId: string | null };
/** Панель очереди: id null — «Текущие заявки». */
export type BoardQueue = { id: string | null; name: string; tasks: BacklogTask[] };

const QUEUE_PREFIX = "queue:";
const queueContainer = (key: string) => `${QUEUE_PREFIX}${key}`;
const isQueueContainer = (container: string) => container.startsWith(QUEUE_PREFIX);
const queueKeyOfContainer = (container: string) => container.slice(QUEUE_PREFIX.length);

/** queues — заявки панелей по ключу очереди (lib/business/backlog-queues.ts::queueKey). */
type BoardState = { days: Record<string, DayTask[]>; queues: Record<string, BacklogTask[]> };

/** container — дата "YYYY-MM-DD" или "queue:<ключ>"; taskId отсутствует у самой колонки. */
type DragData = { container: string; taskId?: string; title?: string };

type Move =
  | { type: "reorder"; date: string; from: number; to: number }
  | { type: "changeDay"; taskId: string; fromDate: string; toDate: string; index: number }
  | { type: "plan"; taskId: string; fromQueue: string; toDate: string; index: number }
  | { type: "toBacklog"; taskId: string; today: string }
  | { type: "moveInQueues"; taskId: string; fromQueue: string; toQueue: string; index: number };
```

В `applyMove`:

`case "plan"` — заменить поиск и возврат:

```ts
    case "plan": {
      const source = state.queues[move.fromQueue] ?? [];
      const task = source.find((t) => t.id === move.taskId);
      if (!task) return state;
      // Возврат отложенной задачи в тот же день заменяет её историческую карточку.
      const target = state.days[move.toDate].filter((t) => t.id !== move.taskId);
      target.splice(Math.min(move.index, target.length), 0, {
        ...task,
        status: task.status === "new" ? "planned" : task.status,
        isHistory: false,
        transferNote: null,
        canChangeDay: task.lastWorkDate === null,
      });
      return {
        queues: { ...state.queues, [move.fromQueue]: source.filter((t) => t.id !== move.taskId) },
        days: { ...state.days, [move.toDate]: target },
      };
    }
```

`case "toBacklog"` — заменить `return`:

```ts
      // Заявка возвращается наверх своей очереди.
      const key = queueKey(task.queueId);
      return {
        days,
        queues: {
          ...state.queues,
          [key]: [
            { ...task, isHistory: false, transferNote: null, lastWorkDate: lastKept },
            ...(state.queues[key] ?? []),
          ],
        },
      };
```

Новый `case` в конце `switch`:

```ts
    case "moveInQueues":
      return {
        ...state,
        queues: moveTaskBetweenQueues(state.queues, move.taskId, move.fromQueue, move.toQueue, move.index),
      };
```

- [ ] **Step 4: `week-board.tsx` — `checkDrop`**

Заменить начало функции (ветку из панели и ветку дня в панель):

```ts
  if (isQueueContainer(from.container)) {
    const task = state.queues[queueKeyOfContainer(from.container)]?.find((t) => t.id === from.taskId);
    if (!task) return null;
    // Внутри очереди и между очередями; «ничего не изменилось» решает onDragEnd.
    if (isQueueContainer(target)) return { ok: true };
    if (target in daysOff) return { ok: false, reason: dayOffReason(target) };
    return canPlanOnDate(task.lastWorkDate, target)
      ? { ok: true }
      : {
          ok: false,
          reason: `Заявку уже вели до ${formatDateLong(task.lastWorkDate!)} — запланируйте её не раньше этого дня.`,
        };
  }

  const task = state.days[from.container]?.find((t) => t.id === from.taskId);
  if (!task) return null;

  if (isQueueContainer(target)) {
    if (task.isHistory) return { ok: false, reason: HISTORY_REASON };
    if (!canReturnToBacklog(task.status)) {
      return { ok: false, reason: "Завершённую или отменённую заявку нельзя вернуть в текущие заявки." };
    }
    if (queueKeyOfContainer(target) !== queueKey(task.queueId)) {
      return {
        ok: false,
        reason: "Заявка возвращается в свою очередь. Перенести её в другую можно из панели очереди.",
      };
    }
    return { ok: true };
  }
```

(остаток функции — `if (target === from.container) ...` и далее — без изменений.)

- [ ] **Step 5: `week-board.tsx` — `WeekBoard`**

Пропы: заменить `backlog` на `queues`:

```ts
  queues,
```

```ts
  /** Панели очередей в порядке показа: первая — «Текущие заявки». */
  queues: BoardQueue[];
```

Состояние:

```ts
  const serverState = useMemo<BoardState>(
    () => ({ days, queues: Object.fromEntries(queues.map((q) => [queueKey(q.id), q.tasks])) }),
    [days, queues],
  );
```

`onDragEnd` — после проверки `verdict` заменить всё до конца функции:

```ts
    // Вставка в чужой список — перед карточкой под курсором или после неё,
    // если перетаскиваемая карточка ниже её середины.
    const translated = dragged.rect.current.translated;
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;

    if (isQueueContainer(to.container)) {
      if (!isQueueContainer(from.container)) {
        run({ type: "toBacklog", taskId, today }, () => returnTaskToBacklogAction(projectId, taskId));
        return;
      }
      const fromQueue = queueKeyOfContainer(from.container);
      const toQueue = queueKeyOfContainer(to.container);
      const target = board.queues[toQueue] ?? [];
      const index = queueDropIndex(target, taskId, to.taskId ?? null, below);
      if (fromQueue === toQueue && target.findIndex((t) => t.id === taskId) === index) return;
      run({ type: "moveInQueues", taskId, fromQueue, toQueue, index }, () =>
        moveBacklogTaskAction(projectId, { taskId, queueId: queueIdOf(toQueue), position: index }),
      );
      return;
    }

    const toDate = to.container;
    const list = board.days[toDate] ?? [];
    const overIndex = to.taskId ? list.findIndex((t) => t.id === to.taskId) : -1;

    if (from.container === toDate) {
      const fromIndex = list.findIndex((t) => t.id === taskId);
      const toIndex = overIndex === -1 ? list.length - 1 : overIndex;
      if (fromIndex === -1 || fromIndex === toIndex) return;
      run({ type: "reorder", date: toDate, from: fromIndex, to: toIndex }, () =>
        moveTaskScheduleAction(projectId, { taskId, fromDate: toDate, toDate, position: toIndex }),
      );
      return;
    }

    const index = overIndex === -1 ? list.length : overIndex + (below ? 1 : 0);

    if (isQueueContainer(from.container)) {
      run({ type: "plan", taskId, fromQueue: queueKeyOfContainer(from.container), toDate, index }, () =>
        planTaskOnDayAction(projectId, { taskId, workDate: toDate, position: index }),
      );
    } else {
      run({ type: "changeDay", taskId, fromDate: from.container, toDate, index }, () =>
        moveTaskScheduleAction(projectId, { taskId, fromDate: from.container, toDate, position: index }),
      );
    }
  };
```

`activeTask`:

```ts
  const activeTask =
    active === null
      ? null
      : isQueueContainer(active.container)
        ? board.queues[queueKeyOfContainer(active.container)]?.find((t) => t.id === active.taskId)
        : board.days[active.container]?.find((t) => t.id === active.taskId);
```

В `DragOverlay`: `active.container === BACKLOG ?` → `isQueueContainer(active.container) ?`.

Нижняя сетка — вместо `<BacklogPanel ... />`:

```tsx
          {queues.map((queue) => {
            const key = queueKey(queue.id);
            return (
              <QueuePanel
                key={key}
                projectId={projectId}
                queueId={queue.id}
                name={queue.name}
                tasks={board.queues[key] ?? []}
                categories={categories}
                highlighted={dropAllowed(queueContainer(key))}
                canEdit={canEdit}
              />
            );
          })}
```

Комментарий над сеткой: «Дополнительные списки: «Текущие заявки» (задачи)…» → «Панели очередей текущих заявок (основная и дополнительные), затем board_lists (стандартные и пользовательские) — по четыре панели в ряду…» (остаток текста без изменений).

- [ ] **Step 6: `week-board.tsx` — `QueuePanel` и `SortableTaskRow`**

Заменить `BacklogPanel` и `DraggableTaskRow` целиком:

```tsx
function QueuePanel({
  projectId,
  queueId,
  name,
  tasks,
  categories,
  highlighted,
  canEdit,
}: {
  projectId: string;
  /** null — «Текущие заявки». */
  queueId: string | null;
  name: string;
  tasks: BacklogTask[];
  categories: { id: string; name: string }[];
  highlighted: boolean;
  canEdit: boolean;
}) {
  const container = queueContainer(queueKey(queueId));
  const { setNodeRef } = useDroppable({ id: container, data: { container } satisfies DragData });

  return (
    <div ref={setNodeRef} className="flex min-w-0">
      <Panel className={cn("flex-1 transition-shadow duration-120", highlighted && DROP_HIGHLIGHT)}>
        <PanelHeader icon={<BookmarkIcon />} title={name} count={tasks.length} />
        {canEdit ? <CreateTaskForm projectId={projectId} queueId={queueId} categories={categories} /> : null}
        {tasks.length === 0 ? (
          <PanelEmpty>{queueId === null ? "Нет текущих заявок" : "Нет заявок"}</PanelEmpty>
        ) : (
          <SortableContext
            items={tasks.map((t) => `${container}|${t.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col p-1.5">
              {tasks.map((task) => (
                <SortableTaskRow
                  key={task.id}
                  projectId={projectId}
                  container={container}
                  task={task}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </Panel>
    </div>
  );
}

// Порядок в очереди ручной (tasks.backlog_position, 0018): строки сортируются
// внутри панели, переносятся в другие очереди и в дни.
function SortableTaskRow({
  projectId,
  container,
  task,
  canEdit,
}: {
  projectId: string;
  container: string;
  task: BacklogTask;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${container}|${task.id}`,
    data: { container, taskId: task.id, title: task.title } satisfies DragData,
    disabled: !canEdit,
  });

  if (!canEdit) {
    return <TaskRow projectId={projectId} task={task} />;
  }

  return (
    <TaskRow
      ref={setNodeRef}
      projectId={projectId}
      task={task}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...dragAttributes(attributes)}
      {...dragListeners(listeners)}
      className={cn(DRAGGABLE_CLASS, isDragging && "opacity-40")}
    />
  );
}
```

- [ ] **Step 7: Проверить**

Run: `grep -n "BACKLOG\|useDraggable\|board.backlog" "app/(app)/[projectId]/board/week-board.tsx"; npx tsc --noEmit && npx eslint "app/(app)/[projectId]/board" && npm test 2>&1 | tail -5`
Expected: grep ничего не находит; tsc и eslint без ошибок; vitest — все тесты pass.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/[projectId]/board"
git commit -m "feat: панели очередей и ручной порядок на доске"
```

---

### Task 6: Страница заявки и страница «Заявки»

**Files:**
- Modify: `app/(app)/[projectId]/tasks/[taskId]/page.tsx`
- Modify: `app/(app)/[projectId]/tasks/[taskId]/task-details-form.tsx`
- Modify: `app/(app)/[projectId]/tasks/page.tsx`
- Modify: `app/(app)/[projectId]/tasks/create-task-form.tsx`

**Interfaces:**
- Consumes: `updateTaskQueueAction`, `createTaskAction` с `queueId` (Task 4).
- Produces: `TaskDetailsForm` пропы `task.queueId: string` (пустая строка — основная) и `queues: { id: string; name: string }[]`; `CreateTaskForm` (страница «Заявки») проп `queues`.

- [ ] **Step 1: `task-details-form.tsx` — поле «Очередь»**

Импорт: добавить `updateTaskQueueAction` в импорт из `./actions`.

Пропы `TaskDetailsForm`: `task: { title: string; description: string; categoryId: string; queueId: string };` и `queues: Category[];` (тот же тип `{ id, name }`). Внутри `fieldset` после `CategoryField`:

```tsx
      {/* Поле нужно, только когда кроме «Текущих заявок» есть другие очереди. */}
      {queues.length > 0 ? (
        <QueueField projectId={projectId} taskId={taskId} initialValue={task.queueId} queues={queues} />
      ) : null}
```

В конец файла:

```tsx
function QueueField({
  projectId,
  taskId,
  initialValue,
  queues,
}: {
  projectId: string;
  taskId: string;
  initialValue: string;
  queues: Category[];
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateTaskQueueAction(projectId, taskId, next || null);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="queueId">Очередь</Label>
      <NativeSelect id="queueId" value={value} disabled={pending} onChange={(e) => onChange(e.target.value)}>
        <option value="">Текущие заявки</option>
        {queues.map((queue) => (
          <option key={queue.id} value={queue.id}>
            {queue.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
```

- [ ] **Step 2: `tasks/[taskId]/page.tsx` — данные**

В запрос задачи добавить `queue_id`: `.select("id, title, description, category_id, queue_id, status, planned_date")`. В `Promise.all` добавить запрос (деструктурировать как `{ data: queues }`):

```ts
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
```

В `<TaskDetailsForm>`: в объект `task` добавить `queueId: task.queue_id ?? "",`, проп `queues={queues ?? []}`.

- [ ] **Step 3: `tasks/create-task-form.tsx` и `tasks/page.tsx`**

`CreateTaskForm`: проп `queues: Category[]`; после select категории:

```tsx
      {queues.length > 0 ? (
        <NativeSelect aria-label="Очередь" {...register("queueId")} defaultValue="">
          <option value="">Текущие заявки</option>
          {queues.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
```

`tasks/page.tsx`: в `Promise.all` добавить тот же запрос `task_queues` (`{ data: queues }`) и передать `queues={queues ?? []}` в `<CreateTaskForm>`.

- [ ] **Step 4: Проверить**

Run: `npx tsc --noEmit && npx eslint "app/(app)/[projectId]/tasks"`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/[projectId]/tasks"
git commit -m "feat: выбор очереди на странице заявки и при создании"
```

---

### Task 7: Настройки — раздел «Очереди заявок»

**Files:**
- Create: `app/(app)/[projectId]/settings/lists/create-queue-form.tsx`
- Create: `app/(app)/[projectId]/settings/lists/queue-row.tsx`
- Modify: `app/(app)/[projectId]/settings/lists/page.tsx`

**Interfaces:**
- Consumes: `createTaskQueueAction`, `renameTaskQueueAction`, `deleteTaskQueueAction` (Task 4); `taskQueueSchema`, `TaskQueueInput` (Task 2).

- [ ] **Step 1: `create-queue-form.tsx`**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { taskQueueSchema, type TaskQueueInput } from "@/lib/validation/task-queue";

import { createTaskQueueAction } from "./actions";

export function CreateQueueForm({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TaskQueueInput>({ resolver: zodResolver(taskQueueSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createTaskQueueAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Очередь добавлена на доску.");
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
      <div className="flex flex-1 flex-col gap-1">
        <Input placeholder="Название очереди" {...register("name")} />
        {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Добавление…" : "Добавить"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: `queue-row.tsx`**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { taskQueueSchema, type TaskQueueInput } from "@/lib/validation/task-queue";

import { deleteTaskQueueAction, renameTaskQueueAction } from "./actions";

export type QueueRowData = { id: string; name: string };

export function QueueRow({
  projectId,
  queue,
  canEdit,
}: {
  projectId: string;
  queue: QueueRowData;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskQueueInput>({
    resolver: zodResolver(taskQueueSchema),
    defaultValues: { name: queue.name },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await renameTaskQueueAction(projectId, queue.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const onDelete = () => {
    if (!window.confirm(`Удалить очередь «${queue.name}»? Её заявки перейдут в «Текущие заявки».`)) return;

    startTransition(async () => {
      const result = await deleteTaskQueueAction(projectId, queue.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Очередь удалена.");
      }
    });
  };

  if (editing && canEdit) {
    return (
      <form onSubmit={onSubmit} className="flex items-start gap-2 py-1" noValidate>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("name")} autoFocus />
          {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          Сохранить
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Отмена
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={queue.name}>
        {queue.name}
      </span>
      {canEdit ? (
        <div className="flex flex-none items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
            Удалить
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: `page.tsx` — раздел над списками**

В `Promise.all` добавить запрос и деструктурировать как `{ data: queues, error: queuesError }`:

```ts
    supabase
      .from("task_queues")
      .select("id, name")
      .eq("project_id", projectId)
      // Тот же порядок, что на доске.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
```

После `if (error) console.error(...)`: `if (queuesError) console.error("BoardListsPage queues:", queuesError);`

Импорты: `CreateQueueForm` из `./create-queue-form`, `QueueRow` из `./queue-row`. Перед `<Card>` списков:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Очереди заявок</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12.5px] text-ink-muted">
            Отдельные панели текущих заявок на доске, например «Столярные дела». Очередь заявки
            выбирается при создании и меняется на её странице. При удалении очереди её заявки
            переходят в «Текущие заявки».
          </p>

          {canEdit ? <CreateQueueForm projectId={projectId} /> : null}

          <div className="flex flex-col divide-y divide-line-subtle">
            <div className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">Текущие заявки</span>
              <span className="flex-none text-[11.5px] text-meta">основная</span>
            </div>
            {queuesError ? (
              <EmptyState>Не удалось загрузить очереди. Обновите страницу.</EmptyState>
            ) : (
              (queues ?? []).map((queue) => (
                <QueueRow key={queue.id} projectId={projectId} queue={queue} canEdit={canEdit} />
              ))
            )}
          </div>
        </CardContent>
      </Card>
```

Текст карточки списков: «Списки показываются на доске после «Текущих заявок» в этом порядке.» → «Списки показываются на доске после очередей заявок в этом порядке.». Заголовок страницы `metadata.title` → `"Очереди и списки — Repair Planner"`.

Ссылка на доске `board/page.tsx`: «Настроить списки» / «Списки» оставить как есть (страница та же).

- [ ] **Step 4: Проверить**

Run: `npx tsc --noEmit && npx eslint "app/(app)/[projectId]/settings/lists"`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/[projectId]/settings/lists"
git commit -m "feat: настройка очередей заявок"
```

---

### Task 8: Документация

**Files:**
- Modify: `docs/database.md`, `docs/architecture.md`, `docs/product-requirements.md`, `docs/roadmap.md`

- [ ] **Step 1: `docs/database.md`**

- §1 ER-модель: у `projects` добавить ветку `──* task_queues ──* tasks (queue_id, null — основная очередь)`.
- §4: в перечень связей с составным FK добавить `tasks.queue_id`.
- §5.7 `tasks`: добавить абзац:

  > `queue_id uuid null` (0018) — очередь текущих заявок; `null` — основная «Текущие заявки». Составной FK `tasks_queue_fk (queue_id, project_id) → task_queues (id, project_id) on delete set null (queue_id)`: при удалении очереди заявки уходят в основную. `backlog_position int null` — место в панели очереди; порядок панели `backlog_position asc nulls first, created_at desc, id`. Триггер `tasks_reset_backlog_position` (`private.reset_task_backlog_position`) обнуляет позицию при вставке, смене `planned_date` или `queue_id` и переходе статуса между открытыми и закрытыми — заявка встаёт наверх своей очереди.

- В таблицу RPC перемещения (§5.8, «RPC перемещения на доске») добавить строку:

  > | `move_backlog_task(p_task_id, p_queue_id, p_position)` (0018) | перестановка в панели очереди и перенос между очередями: меняет `queue_id`, перенумеровывает `backlog_position` целевой очереди 0..n-1 под advisory-блокировкой обеих очередей (в порядке ключей); `task_not_found`, `access_denied`, `task_already_planned`, `task_closed`, `queue_not_found` |

- Новый раздел после §5.14:

  > ### 5.15 `task_queues` — очереди текущих заявок (0018)
  >
  > `id`, `project_id`, `name` (1–60 символов после trim), timestamps, `unique (id, project_id)`. Основной очереди строки нет — это `tasks.queue_id is null`, поэтому её нельзя удалить или переименовать. RLS: SELECT — участник проекта, INSERT/UPDATE/DELETE — `project_can_edit`. Право UPDATE у `authenticated` — только на колонку `name`: `project_id` неизменяем.

- В разделе миграций (если есть перечень) — `0018_task_queues.sql`.

- [ ] **Step 2: `docs/architecture.md`**

- §7 Drag-and-drop: заменить описание «Текущих заявок» как только перетаскиваемых в дни на: «Панели очередей текущих заявок („Текущие заявки“ и дополнительные) — сортируемые списки (`useSortable`), контейнеры `queue:<ключ>`; ключ основной очереди — `main` (`lib/business/backlog-queues.ts`). Внутри очереди и между очередями — RPC `move_backlog_task`; из дня — только в панель своей очереди, заявка встаёт наверх».
- §12: добавить `lib/business/backlog-queues.test.ts`, `lib/validation/*.test.ts`, `supabase/tests/database/task-queues.test.sql`.

- [ ] **Step 3: `docs/product-requirements.md`**

- §4.4 Drag-and-drop: добавить абзац про ручной порядок в панели и перенос между очередями; возврат с доски — наверх своей очереди.
- §4.10 Дополнительные списки: добавить абзац «Очереди заявок» — что это, чем отличается от списков (в очереди — заявки, в списке — пункты), основная очередь неудаляема, при удалении очереди заявки переходят в основную.

- [ ] **Step 4: `docs/roadmap.md`**

В «После MVP» добавить:

```markdown
- Метка очереди на карточках в днях недели.
- Фильтр по очереди на странице «Заявки».
- Ручной порядок панелей очередей на доске.
```

- [ ] **Step 5: Commit**

```bash
git add docs/database.md docs/architecture.md docs/product-requirements.md docs/roadmap.md
git commit -m "docs: очереди заявок и ручной порядок"
```

---

### Task 9: Полная проверка

**Files:** без изменений кода (только исправления найденного — по TDD).

- [ ] **Step 1: Автоматические проверки**

Run: `npx tsc --noEmit && npx eslint . && npm test 2>&1 | tail -5 && supabase test db 2>&1 | tail -5 && npm run build 2>&1 | tail -15`
Expected: tsc и eslint чисто; vitest — все pass (126 + новые); pgTAP — 215 ok; build успешен.

- [ ] **Step 2: Браузер, ширина 1280** (dev-сервер `preview_start` конфигурация `dev`; перед доверием скриптовым проверкам — скриншот, скрытая панель тормозит страницу)

1. «Текущие заявки»: перетащить нижнюю заявку наверх → порядок сразу; после перезагрузки тот же.
2. Настройки → «Очереди заявок»: создать «Столярные дела» → панель на доске после «Текущих заявок».
3. Создать заявку из формы панели «Столярные дела» → появляется в ней наверху.
4. Перетащить заявку из «Текущих заявок» в «Столярные дела» между двумя строками → встаёт на это место; после перезагрузки там же.
5. Заявку из «Столярных дел» — в день; затем из дня в «Текущие заявки» → отказ с текстом про свою очередь; из дня в «Столярные дела» → наверх.
6. Страница заявки: поле «Очередь», смена на «Текущие заявки» → на доске наверху основной панели.
7. Запланировать одну заявку «Столярных дел» на день, затем удалить очередь (подтверждение) → её заявки в «Текущих заявках» наверху; запланированную вернуть с доски → она в «Текущих заявках».
8. Консоль браузера без ошибок (`read_console_messages`, `onlyErrors`).

- [ ] **Step 3: Браузер, ширина 375** — п. 1 и 4 долгим нажатием (тач-сенсор), формы панелей не ломают сетку.

- [ ] **Step 4: «Только просмотр»** — войти тестовым viewer-пользователем проекта (создать в этой сессии через приглашение, данные — в scratchpad); на доске нет форм и перетаскивания, на странице заявки поле «Очередь» недоступно, в настройках нет кнопок.

- [ ] **Step 5: Отчёт пользователю** по разделам «Что сделано / Изменения / Проверка / Проблемы / решения / Следующий шаг»: перечень коммитов, миграция `0018` (на прод не применена), что проверено и что нет. Merge в `main`, push и `supabase db push` — только после явного подтверждения.
