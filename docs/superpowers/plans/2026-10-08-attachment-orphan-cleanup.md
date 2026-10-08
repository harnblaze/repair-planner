# Очистка файлов-«сирот» в Storage — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** После успешной загрузки фото сервер в фоне удаляет файлы проекта в bucket `task-attachments`, у которых больше суток нет строки `task_attachments`.

**Architecture:** SQL-функция `task_attachment_orphans` (security invoker, только для редакторов) находит пути; серверный хелпер `cleanupAttachmentOrphans` удаляет их одним вызовом Storage API сессией пользователя; `confirmTaskAttachmentAction` запускает хелпер через `after()` из `next/server`.

**Tech Stack:** Next.js 16 App Router (server actions, `after`), Supabase PostgreSQL + Storage + RLS, pgTAP, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-attachment-orphan-cleanup-design.md`

## Global Constraints

- Без service role, без планировщика, без новых npm-зависимостей (CLAUDE.md §11).
- «Сирота» — объект `storage.objects` с `bucket_id = 'task-attachments'`, путём `{project_id}/…`, `created_at < now() - interval '1 day'`, без строки `task_attachments` с `storage_path = name`.
- Удаление — только через Storage API (`remove`), прямой `delete from storage.objects` запрещён платформой (`protect_objects_delete`).
- Функция БД: `language sql stable`, `set search_path = ''`, security invoker, только при `public.project_can_edit(p_project_id)`, `limit least(greatest(coalesce(p_limit, 1), 1), 1000)`, по умолчанию 100, `revoke all … from public, anon`, `grant execute … to authenticated`.
- Очистка не видна пользователю и не влияет на результат загрузки; ошибки — только `console.error` (CLAUDE.md §31).
- Никогда `supabase db reset`. Локально миграции — `supabase migration up --local`.

## Review Focus

- Файл, загрузка которого идёт прямо сейчас (объект есть, строки ещё нет), не удаляется — он моложе суток (pgTAP «свежий файл», Task 1).
- Файл со строкой `task_attachments` никогда не попадает в выборку — для редактора RLS видит все строки проекта (pgTAP «файл со строкой» от лица member, Task 1).
- Файлы чужого проекта и другого bucket с тем же префиксом не попадают в выборку (pgTAP, Task 1).
- Сбой RPC, Storage или исключение в хелпере не ломают загрузку фото (vitest, Task 2 и Task 3).
- Неуспешное подтверждение загрузки не запускает очистку (vitest, Task 3).

---

### Task 1: SQL-функция `task_attachment_orphans` (миграция 0026)

**Files:**
- Create: `supabase/migrations/0026_task_attachment_orphans.sql`
- Create: `supabase/tests/database/attachment-orphans.test.sql`
- Modify: `lib/types/database.ts` (генерация)

**Interfaces:**
- Produces: RPC `task_attachment_orphans(p_project_id uuid, p_limit int default 100)` → `setof text` (пути `{project}/{task}/{uuid}.jpg`, порядок `created_at, name`); в supabase-js `data: string[]`.

- [ ] **Step 1: Написать pgTAP-тест**

`supabase/tests/database/attachment-orphans.test.sql`:

```sql
-- Поиск файлов-«сирот» в bucket task-attachments (0026): public.task_attachment_orphans.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(9);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A, D — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'orph-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'orph-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'orph-viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'orph-member-d@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.tasks (id, project_id, title) values
  ('e2000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e2000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A2'),
  ('e2000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Task B');

insert into storage.buckets (id, name, public) values ('orphans-test-other', 'orphans-test-other', false);

-- O1 — сирота 2 дня, O2 — сирота 3 дня (старше, идёт первой), F — свежая сирота,
-- L — файл со строкой, BO — сирота проекта B, X — тот же префикс в другом bucket.
insert into storage.objects (bucket_id, name, created_at) values
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000001.jpg', now() - interval '2 days'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg', now() - interval '3 days'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000003.jpg', now() - interval '1 hour'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000004.jpg', now() - interval '2 days'),
  ('task-attachments', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e2000000-0000-0000-0000-00000000000b/f2000000-0000-0000-0000-000000000005.jpg', now() - interval '2 days'),
  ('orphans-test-other', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000006.jpg', now() - interval '2 days');

insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e2000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000004.jpg',
   1000, 10, 10);

-- 1-2
select has_function('public', 'task_attachment_orphans', array['uuid', 'integer'], 'task_attachment_orphans exists');
select ok(
  not has_function_privilege('anon', 'public.task_attachment_orphans(uuid, integer)', 'execute'),
  'anon cannot execute task_attachment_orphans'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Только старые сироты своего проекта в этом bucket, старшая первой
select is(
  array(select public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  array[
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-00000000000a/f2000000-0000-0000-0000-000000000001.jpg'
  ],
  'old orphans of own project only, oldest first'
);

-- 4. p_limit ограничивает выборку
select is(
  array(select public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1)),
  array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e2000000-0000-0000-0000-0000000000a2/f2000000-0000-0000-0000-000000000002.jpg'],
  'p_limit limits the result'
);

-- 5. Некорректный предел приводится к 1, а не к ошибке
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0)),
  1::bigint,
  'non-positive p_limit is clamped to 1'
);

-- 6. Чужой проект — пусто
select is(
  (select count(*) from public.task_attachment_orphans('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  0::bigint,
  'foreign project gives nothing'
);

reset role;

-- ================= Member D =================

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 7. Редактор видит те же сироты
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  2::bigint,
  'member gets the same orphans'
);

-- 8. Файл со строкой не сирота и для редактора
select ok(
  not exists (
    select 1 from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as p(path)
      where p.path like '%f2000000-0000-0000-0000-000000000004.jpg'
  ),
  'file with an attachment row is never an orphan'
);

reset role;

-- ================= Viewer C =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 9. Наблюдатель удалять не может — пусто
select is(
  (select count(*) from public.task_attachment_orphans('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0::bigint,
  'viewer gets nothing'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 2: Запустить — тест падает**

Run: `supabase test db 2>&1 | grep -E "attachment-orphans|does not exist|Result"`
Expected: FAIL — `function public.task_attachment_orphans(...) does not exist` (или `has_function` not ok).

- [ ] **Step 3: Написать миграцию**

`supabase/migrations/0026_task_attachment_orphans.sql`:

```sql
-- Поиск файлов-«сирот» в bucket task-attachments
-- (docs/superpowers/specs/2026-10-08-attachment-orphan-cleanup-design.md):
-- объекты проекта старше суток без строки task_attachments — оборванные
-- загрузки и сбои удаления. Удаляет их сервер через Storage API сессией
-- пользователя (прямой delete из storage.objects запрещён платформой).
-- security invoker: RLS storage.objects и task_attachments действует; список
-- получают только редакторы — удалять файлы остальные всё равно не могут.
-- Сутки защищают загрузки в процессе (подписанная ссылка живёт 2 часа).

create or replace function public.task_attachment_orphans(
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
      and o.bucket_id = 'task-attachments'
      and o.name like p_project_id::text || '/%'
      and o.created_at < now() - interval '1 day'
      and not exists (
        select 1 from public.task_attachments a where a.storage_path = o.name
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$$;

revoke all on function public.task_attachment_orphans(uuid, int) from public, anon;
grant execute on function public.task_attachment_orphans(uuid, int) to authenticated;
```

- [ ] **Step 4: Применить локально и прогнать тесты**

Run: `supabase migration up --local && supabase test db 2>&1 | grep -E "not ok|Result|Files="`
Expected: `Result: PASS`, всего 298 + 9 = 307.

- [ ] **Step 5: Сгенерировать типы**

Run: `supabase gen types typescript --local > lib/types/database.ts 2>/dev/null && grep -n "task_attachment_orphans" lib/types/database.ts`
Expected: функция в типах, `Returns: string[]`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0026_task_attachment_orphans.sql supabase/tests/database/attachment-orphans.test.sql lib/types/database.ts
git commit -m "feat(attachments): RPC task_attachment_orphans (0026)"
```

---

### Task 2: Серверный хелпер очистки

**Files:**
- Create: `lib/attachments/cleanup.ts`
- Create: `lib/attachments/cleanup.test.ts`

**Interfaces:**
- Consumes: RPC `task_attachment_orphans` (Task 1); `ATTACHMENTS_BUCKET` (`lib/business/attachments.ts`); тип клиента — `Awaited<ReturnType<typeof createClient>>` из `lib/supabase/server.ts`.
- Produces: `cleanupAttachmentOrphans(supabase: Supabase, projectId: string): Promise<number>` — число удалённых файлов; никогда не бросает.

- [ ] **Step 1: Тесты**

`lib/attachments/cleanup.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupAttachmentOrphans } from "./cleanup";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const P1 = `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-000000000001.jpg`;
const P2 = `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-000000000002.jpg`;

function fakeClient(rpcResult: unknown, removeResult: unknown = { data: [], error: null }) {
  const remove = vi.fn(async () => removeResult);
  const from = vi.fn(() => ({ remove }));
  const rpc = vi.fn(async () => rpcResult);
  return { client: { rpc, storage: { from } } as never, rpc, from, remove };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanupAttachmentOrphans", () => {
  it("removes all found orphans with one Storage call", async () => {
    const { client, rpc, from, remove } = fakeClient({ data: [P1, P2], error: null });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(2);
    expect(rpc).toHaveBeenCalledWith("task_attachment_orphans", { p_project_id: PROJECT });
    expect(from).toHaveBeenCalledWith("task-attachments");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([P1, P2]);
  });

  it("does not call Storage when there are no orphans", async () => {
    const { client, remove } = fakeClient({ data: [], error: null });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it("logs an RPC error and removes nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient({ data: null, error: { message: "boom" } });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("logs a Storage error and reports nothing removed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: [P1], error: null }, { data: null, error: { message: "boom" } });
    expect(await cleanupAttachmentOrphans(client, PROJECT)).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it("never throws, even when the client throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { rpc: vi.fn(async () => Promise.reject(new Error("network"))) } as never;
    await expect(cleanupAttachmentOrphans(client, PROJECT)).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run lib/attachments/cleanup.test.ts`
Expected: FAIL — `Cannot find module './cleanup'`.

- [ ] **Step 3: Реализация**

`lib/attachments/cleanup.ts`:

```ts
import { ATTACHMENTS_BUCKET } from "@/lib/business/attachments";
import type { createClient } from "@/lib/supabase/server";

// Только сервер: удаление файлов-«сирот» проекта в bucket task-attachments
// (docs/superpowers/specs/2026-10-08-attachment-orphan-cleanup-design.md).
// Поиск — RPC task_attachment_orphans (0026), удаление — Storage API сессией
// пользователя под RLS. Работает в фоне после загрузки фото: ошибки только
// логируются, функция не бросает.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Удаляет найденные «сироты» проекта; возвращает число удалённых файлов. */
export async function cleanupAttachmentOrphans(supabase: Supabase, projectId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("task_attachment_orphans", { p_project_id: projectId });
    if (error) {
      console.error("cleanupAttachmentOrphans (rpc):", error);
      return 0;
    }

    const paths = data ?? [];
    if (paths.length === 0) return 0;

    const { error: removeError } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
    if (removeError) {
      console.error("cleanupAttachmentOrphans (storage):", removeError);
      return 0;
    }

    return paths.length;
  } catch (error) {
    console.error("cleanupAttachmentOrphans:", error);
    return 0;
  }
}
```

- [ ] **Step 4: Прогнать**

Run: `npx vitest run lib/attachments/cleanup.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 5 passed, `TSC_OK`.

- [ ] **Step 5: Commit**

```bash
git add lib/attachments/cleanup.ts lib/attachments/cleanup.test.ts
git commit -m "feat(attachments): хелпер удаления файлов-«сирот»"
```

---

### Task 3: Запуск очистки после загрузки фото

**Files:**
- Modify: `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts` (`confirmTaskAttachmentAction`)
- Modify: `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts`

**Interfaces:**
- Consumes: `cleanupAttachmentOrphans` (Task 2); `after` из `next/server`.

- [ ] **Step 1: Тесты**

В `attachment-actions.test.ts` рядом с остальными `vi.mock` добавить:

```ts
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/attachments/cleanup", () => ({ cleanupAttachmentOrphans: vi.fn(async () => 0) }));
```

и импорты после блока моков:

```ts
import { after } from "next/server";

import { cleanupAttachmentOrphans } from "@/lib/attachments/cleanup";
```

В конец файла:

```ts
describe("orphan cleanup after upload", () => {
  it("schedules cleanup of the project after a successful confirm", async () => {
    const { client } = fakeClient({ task_attachments: [{ error: null }] });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
    expect(cleanupAttachmentOrphans).not.toHaveBeenCalled();

    const task = (after as Mock).mock.calls[0][0] as () => Promise<unknown>;
    await task();
    expect(cleanupAttachmentOrphans).toHaveBeenCalledWith(client, PROJECT);
  });

  it("schedules cleanup on a repeated confirm of the same path", async () => {
    const { client } = fakeClient({
      task_attachments: [{ error: { code: "23505", message: "duplicate key" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does not schedule cleanup when the confirm fails", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23503", message: "fk violation" } }],
    });
    state.client = client;
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).ok).toBe(false);

    storage.list.mockResolvedValueOnce({ data: [], error: null });
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).ok).toBe(false);

    expect(after).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — падают новые тесты**

Run: `npx vitest run "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts"`
Expected: FAIL в `schedules cleanup …` (`after` не вызван); остальные тесты зелёные.

- [ ] **Step 3: Реализация**

В `attachment-actions.ts` импорты:

```ts
import { after } from "next/server";

import { cleanupAttachmentOrphans } from "@/lib/attachments/cleanup";
```

В `confirmTaskAttachmentAction` перед `revalidatePath(...)` в конце успешной ветки:

```ts
  // Фоном после ответа: файлы-«сироты» проекта старше суток (0026). Сбой
  // очистки только логируется и на загрузку не влияет.
  after(() => cleanupAttachmentOrphans(supabase, projectId));

  revalidatePath(`/${projectId}/tasks/${taskId}`);
  return { ok: true };
```

- [ ] **Step 4: Прогнать**

Run: `npx vitest run "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts" && npx tsc --noEmit && echo TSC_OK && npx eslint . && echo LINT_OK`
Expected: все тесты файла зелёные, `TSC_OK`, `LINT_OK`.

- [ ] **Step 5: Браузер (локальный проект `1b919349-da4f-4481-b218-9d1552e40180`)**

1. `preview_start` `dev`; открыть карточку любой открытой заявки проекта.
2. Загрузить фото через поле выбора файла (в скрытой панели: создать JPEG через `canvas.toBlob`, положить в `input[type=file]` через `DataTransfer`, отправить `change`).
3. Сделать из него «сироту» (psql, `set statement_timeout='5s'`):
   `delete from public.task_attachments where storage_path = '<путь>';`
   `update storage.objects set created_at = now() - interval '2 days' where bucket_id = 'task-attachments' and name = '<путь>';`
4. Загрузить второе фото в другую заявку того же проекта.
5. Через 2–3 с проверить: `select count(*) from storage.objects where name = '<путь сироты>'` → 0; второе фото видно в карточке; консоль без ошибок; в `preview_logs` нет `cleanupAttachmentOrphans`.
6. Удалить второе фото кнопкой в карточке (временные данные).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts" "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts"
git commit -m "feat(attachments): очистка файлов-«сирот» после загрузки фото"
```

---

### Task 4: Документация и финальная проверка

**Files:**
- Modify: `docs/database.md`, `docs/architecture.md`, `docs/roadmap.md`

- [ ] **Step 1: database.md.** В таблицу RPC — строка `task_attachment_orphans(p_project_id, p_limit default 100)` (0026): пути файлов bucket `task-attachments` проекта старше суток без строки `task_attachments`, порядок `created_at, name`, предел 1–1000; только для `project_can_edit`, иначе пусто; `language sql stable`, security invoker, RLS `storage.objects`. В §5.14 — абзац «Файлы-„сироты“» со ссылкой на функцию. В список миграций — `26. 0026_task_attachment_orphans — RPC task_attachment_orphans для очистки файлов без строки task_attachments.`

- [ ] **Step 2: architecture.md.** В §3.1 после абзаца об удалении: «Файлы-„сироты“ (оборванная загрузка, сбой удаления) удаляет `confirmTaskAttachmentAction` фоном через `after()`: `lib/attachments/cleanup.ts` → RPC `task_attachment_orphans` (0026) → один `storage.remove` сессией пользователя; только файлы старше суток, ошибки только логируются. Service role и планировщик не используются.»

- [ ] **Step 3: roadmap.md.** `10. ~~Очистка файлов-«сирот» в bucket task-attachments~~ — сделано (0026, 2026-10-08): после загрузки фото, файлы старше суток.` Пункт 11 заменить: `11. При появлении удаления проекта — удалять его файлы из Storage в том же действии (очистка «сирот» в проекте без новых загрузок не сработает). Файлы удалённой задачи уберёт очистка «сирот» через сутки.`

- [ ] **Step 4: Полная проверка**

Run: `npx tsc --noEmit && npx eslint . && npm test && supabase test db && npm run build`
Expected: всё зелёное (vitest 207 + 8 = 215, pgTAP 307), сборка успешна.

Run: `supabase db push --dry-run`
Expected: к отправке только `0026_task_attachment_orphans.sql`.

- [ ] **Step 5: Commit**

```bash
git add docs/database.md docs/architecture.md docs/roadmap.md
git commit -m "docs: очистка файлов-«сирот» в Storage (п. 10)"
```
