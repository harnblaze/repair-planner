# Архив и удаление проектов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Владелец отправляет проект в архив, возвращает его и удаляет навсегда из архива (с файлами в Storage); удаление проекта с расходом материалов больше не падает.

**Architecture:** Миграция 0027: ранний выход триггера `apply_task_material_change` при каскаде, политика DELETE только для архивного проекта, RPC путей файлов архивного проекта. Три server action в `app/(app)/projects/actions.ts`; удаление — сначала файлы пачками через Storage API, затем строка проекта под RLS. UI — карточка «Архив» в настройках и раздел «Архив (N)» на `/projects`.

**Tech Stack:** Next.js 16 App Router (server actions), Supabase PostgreSQL + Storage + RLS, pgTAP, vitest, sonner.

**Spec:** `docs/superpowers/specs/2026-10-08-project-archive-delete-design.md`

## Global Constraints

- Только владелец (`project_access = 'owner'`) архивирует, возвращает и удаляет; гарантия — RLS, не UI.
- Удалить можно только проект с `archived_at is not null` (политика `projects_delete`).
- Порядок удаления: файлы → строка проекта. Сбой файлов — проект не удаляется.
- Подтверждение удаления — название проекта, сравнение после `trim`, с учётом регистра; проверка и на клиенте, и на сервере.
- Без service role, без новых npm-зависимостей, без модального компонента (CLAUDE.md §11).
- Пользователю — только понятные сообщения из `PROJECT_MESSAGES`; детали — `console.error` (CLAUDE.md §31).
- Никогда `supabase db reset`. Локально — `supabase migration up --local`.

## Review Focus

- Участник (member) архивного проекта вызывает `deleteProjectAction` с верным названием: файлы не удаляются (RPC даёт пусто), проект не удаляется, сообщение о правах (vitest «0 rows on delete» + pgTAP RPC/DELETE для member, Task 1–2).
- Storage удалил не все файлы пачки (RLS отфильтровал часть): цикл останавливается, проект не удаляется (vitest «partial removal», Task 2).
- RPC путей всё время возвращает один и тот же непустой список (Storage молча ничего не удаляет): защита — сравнение числа удалённых и предел 100 пачек (vitest «partial removal», Task 2).
- Название с пробелами по краям — принимается; другое регистровое написание — нет (vitest `confirmsProjectName`, Task 2).
- Удаление расхода в живом проекте после правки триггера по-прежнему возвращает остаток и пишет движение (pgTAP, Task 1).

---

### Task 1: Миграция 0027 — триггер, политика DELETE, RPC путей

**Files:**
- Create: `supabase/migrations/0027_project_archive_delete.sql`
- Create: `supabase/tests/database/project-archive-delete.test.sql`
- Modify: `lib/types/database.ts` (генерация)

**Interfaces:**
- Produces: RPC `project_attachment_paths(p_project_id uuid, p_limit int default 1000)` → `setof text` (в supabase-js `data: string[]`); политика: `delete from projects` проходит только для архивного проекта владельца.

- [ ] **Step 1: pgTAP-тест**

`supabase/tests/database/project-archive-delete.test.sql`:

```sql
-- Архив и удаление проектов (0027): политика DELETE, триггер расхода при
-- каскаде, public.project_attachment_paths.
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(12);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец PA (активный) и PZ (архивный), B — владелец PB (архивный),
-- D — member в PZ.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'arch-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'arch-owner-b@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'arch-member-d@example.com');

insert into public.projects (id, owner_id, name, archived_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Active A', null),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Archived Z', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Archived B', now());

insert into public.project_members (project_id, user_id, role) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.materials (id, project_id, name, unit) values
  ('d3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электрод A', 'кг'),
  ('d3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Электрод Z', 'кг');

insert into public.tasks (id, project_id, title) values
  ('e3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Task Z');

-- Расход: триггер пишет движения consumption в оба проекта.
insert into public.task_materials (id, project_id, task_id, material_id, quantity) values
  ('f3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'e3000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 3),
  ('f3000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'e3000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', 2);

insert into storage.buckets (id, name, public) values ('archive-test-other', 'archive-test-other', false);

insert into storage.objects (bucket_id, name) values
  ('task-attachments', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000002.jpg'),
  ('task-attachments', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000001.jpg'),
  ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e3000000-0000-0000-0000-00000000000a/f4000000-0000-0000-0000-000000000003.jpg'),
  ('archive-test-other', 'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000004.jpg');

-- 1-2
select has_function('public', 'project_attachment_paths', array['uuid', 'integer'], 'project_attachment_paths exists');
select ok(
  not has_function_privilege('anon', 'public.project_attachment_paths(uuid, integer)', 'execute'),
  'anon cannot execute project_attachment_paths'
);

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 3. Активный проект не удаляется даже владельцем
with del as (
  delete from public.projects where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'owner cannot delete an active project');

-- 4. Для активного проекта пути не выдаются
select is(
  (select count(*) from public.project_attachment_paths('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  0::bigint,
  'no paths for an active project'
);

-- 5. Для своего архивного — все его файлы bucket task-attachments, по имени
select is(
  array(select public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc')),
  array[
    'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000001.jpg',
    'cccccccc-cccc-cccc-cccc-cccccccccccc/e3000000-0000-0000-0000-00000000000c/f4000000-0000-0000-0000-000000000002.jpg'
  ],
  'all files of own archived project in task-attachments, by name'
);

-- 6. p_limit ограничивает выборку
select is(
  (select count(*) from public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc', 1)),
  1::bigint,
  'p_limit limits the result'
);

-- 7. Чужой архивный проект не удаляется
with del as (
  delete from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id
)
select is((select count(*) from del), 0::bigint, 'owner cannot delete a foreign archived project');

reset role;

-- ================= Member D =================

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 8. Участнику пути не выдаются
select is(
  (select count(*) from public.project_attachment_paths('cccccccc-cccc-cccc-cccc-cccccccccccc')),
  0::bigint,
  'member gets no paths'
);

-- 9. Участник не удаляет архивный проект
with del as (
  delete from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' returning id
)
select is((select count(*) from del), 0::bigint, 'member cannot delete an archived project');

reset role;

-- ================= Владелец A: удаление =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 10. Удаление расхода в живом проекте по-прежнему пишет движение adjustment
delete from public.task_materials where id = 'f3000000-0000-0000-0000-00000000000a';
select is(
  (select count(*) from public.material_movements
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and kind = 'adjustment' and quantity = 3),
  1::bigint,
  'deleting consumption in a live project still records an adjustment'
);

-- 11. Архивный проект с расходом удаляется (раньше падал на FK журнала)
with del as (
  delete from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' returning id
)
select is((select count(*) from del), 1::bigint, 'owner deletes an archived project with consumption');

reset role;

-- 12. Каскад убрал данные проекта
select is(
  (select count(*) from public.tasks where project_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
  + (select count(*) from public.material_movements where project_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0::bigint,
  'cascade removed tasks and movements of the deleted project'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Запустить — тест падает**

Run: `supabase test db 2>&1 | grep -E "project-archive-delete|does not exist|Result"`
Expected: FAIL — `function public.project_attachment_paths(...) does not exist`.

- [ ] **Step 3: Миграция**

`supabase/migrations/0027_project_archive_delete.sql`:

```sql
-- Архив и удаление проектов
-- (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md).

-- 1. Расход при каскадном удалении проекта. Каскад удаляет task_materials,
--    а триггер писал движение в material_movements уже удалённого проекта —
--    FK material_movements_project_id_fkey ронял удаление. Если проекта нет,
--    остаток и журнал не трогаем: они удаляются тем же каскадом. Удаление
--    расхода в живом проекте работает как прежде.
create or replace function public.apply_task_material_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14, 3);
  v_kind public.movement_kind;
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_material_id uuid := coalesce(new.material_id, old.material_id);
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_task_material_id uuid := coalesce(new.id, old.id);
  v_created_by uuid := coalesce(new.created_by, old.created_by);
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.projects p where p.id = old.project_id
  ) then
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_delta := -new.quantity;
    v_kind := 'consumption';
  elsif tg_op = 'UPDATE' then
    v_delta := -(new.quantity - old.quantity);
    v_kind := 'adjustment';
  else
    -- DELETE: строка task_materials уже удалена, ссылаться на неё нельзя.
    v_delta := old.quantity;
    v_kind := 'adjustment';
    v_task_material_id := null;
  end if;

  if v_delta <> 0 then
    perform set_config('repair_planner.balance_update', 'on', true);

    update public.materials
      set current_balance = current_balance + v_delta
      where id = v_material_id;

    insert into public.material_movements
      (project_id, material_id, kind, quantity, task_id, task_material_id, created_by)
    values
      (v_project_id, v_material_id, v_kind, v_delta, v_task_id, v_task_material_id, v_created_by);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- 2. Удалить можно только проект в архиве — защита от случайного удаления
--    активного проекта и прямым запросом к API.
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete to authenticated
  using (public.project_access(id) = 'owner' and archived_at is not null);

-- 3. Пути файлов архивного проекта для удаления через Storage API перед
--    удалением строки проекта (после него RLS storage.objects файлы не отдаст).
--    security invoker: RLS storage.objects действует; только владельцу.
create or replace function public.project_attachment_paths(
  p_project_id uuid,
  p_limit int default 1000
)
returns setof text
language sql
stable
set search_path = ''
as $$
  select o.name
    from storage.objects o
    where public.project_access(p_project_id) = 'owner'
      and exists (
        select 1 from public.projects p
          where p.id = p_project_id and p.archived_at is not null
      )
      and o.bucket_id = 'task-attachments'
      and o.name like p_project_id::text || '/%'
    order by o.name
    limit least(greatest(coalesce(p_limit, 1), 1), 1000);
$$;

revoke all on function public.project_attachment_paths(uuid, int) from public, anon;
grant execute on function public.project_attachment_paths(uuid, int) to authenticated;
```

- [ ] **Step 4: Применить и прогнать**

Run: `supabase migration up --local && supabase test db 2>&1 | grep -E "not ok|Result|Files="`
Expected: `Result: PASS`, Tests = 307 + 12 = 319.

- [ ] **Step 5: Типы**

Run: `supabase gen types typescript --local > lib/types/database.ts 2>/dev/null && grep -n -A3 "project_attachment_paths" lib/types/database.ts`
Expected: `Args: { p_limit?: number; p_project_id: string }`, `Returns: string[]`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0027_project_archive_delete.sql supabase/tests/database/project-archive-delete.test.sql lib/types/database.ts
git commit -m "feat(projects): удаление только из архива, RPC путей файлов, триггер расхода при каскаде (0027)"
```

---

### Task 2: Server actions архива, возврата и удаления

**Files:**
- Create: `lib/business/project-archive.ts`
- Create: `lib/business/project-archive.test.ts`
- Modify: `lib/errors.ts` (добавить `PROJECT_MESSAGES` в конец файла)
- Modify: `app/(app)/projects/actions.ts`
- Create: `app/(app)/projects/actions.test.ts`

**Interfaces:**
- Consumes: RPC `project_attachment_paths` (Task 1); `ATTACHMENTS_BUCKET` (`lib/business/attachments.ts`); `uuidSchema` (`lib/validation/members.ts`).
- Produces:
  - `confirmsProjectName(input: string, name: string): boolean` в `lib/business/project-archive.ts`;
  - `PROJECT_MESSAGES` в `lib/errors.ts` (ключи `notFound`, `ownerOnly`, `archiveFailed`, `restoreFailed`, `notArchived`, `nameMismatch`, `deleteFailed`);
  - `archiveProjectAction(projectId: string): Promise<ActionResult>` (успех — `redirect("/projects")`), `restoreProjectAction(projectId: string): Promise<ActionResult>`, `deleteProjectAction(projectId: string, confirmName: string): Promise<ActionResult>` в `app/(app)/projects/actions.ts`.

- [ ] **Step 1: Тест `confirmsProjectName`**

`lib/business/project-archive.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { confirmsProjectName } from "./project-archive";

describe("confirmsProjectName", () => {
  it("accepts the exact name", () => {
    expect(confirmsProjectName("Работа", "Работа")).toBe(true);
  });

  it("ignores surrounding spaces", () => {
    expect(confirmsProjectName("  Работа ", "Работа")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(confirmsProjectName("работа", "Работа")).toBe(false);
  });

  it("rejects an empty input", () => {
    expect(confirmsProjectName("   ", "Работа")).toBe(false);
  });
});
```

- [ ] **Step 2: Тест действий**

`app/(app)/projects/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PROJECT_MESSAGES } from "@/lib/errors";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.client) }));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { archiveProjectAction, deleteProjectAction, restoreProjectAction } from "./actions";

const PROJECT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NAME = "Старый цех";
const path = (n: number) => `${PROJECT}/e0000000-0000-0000-0000-00000000000a/f0000000-0000-4000-8000-00000000000${n}.jpg`;

type Builder = {
  select: Mock;
  eq: Mock;
  is: Mock;
  not: Mock;
  update: Mock;
  delete: Mock;
  maybeSingle: Mock;
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
};

function builder(result: unknown): Builder {
  const b = {} as Builder;
  for (const method of ["select", "eq", "is", "not", "update", "delete"] as const) b[method] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

/** projects — результаты по очереди вызовов from("projects"); rpc — по очереди вызовов RPC. */
function fakeClient(projects: unknown[], rpc: unknown[] = [], removes: unknown[] = []) {
  const builders: Builder[] = [];
  const remove = vi.fn(async () => removes.shift() ?? { data: [], error: null });
  const client = {
    from: vi.fn(() => {
      const b = builder(projects.shift());
      builders.push(b);
      return b;
    }),
    rpc: vi.fn(async () => rpc.shift() ?? { data: [], error: null }),
    storage: { from: vi.fn(() => ({ remove })) },
  };
  return { client, builders, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("archiveProjectAction", () => {
  it("archives an active project and goes to the project list", async () => {
    const { client, builders } = fakeClient([{ data: [{ id: PROJECT }], error: null }]);
    state.client = client;
    await archiveProjectAction(PROJECT);
    expect(builders[0].update).toHaveBeenCalledWith({ archived_at: expect.any(String) });
    expect(builders[0].eq).toHaveBeenCalledWith("id", PROJECT);
    expect(builders[0].is).toHaveBeenCalledWith("archived_at", null);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(redirect).toHaveBeenCalledWith("/projects");
  });

  it("reports missing rights when no row was updated", async () => {
    state.client = fakeClient([{ data: [], error: null }]).client;
    expect(await archiveProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("hides database errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.client = fakeClient([{ data: null, error: { message: "boom" } }]).client;
    expect(await archiveProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.archiveFailed });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a malformed id without touching Supabase", async () => {
    expect(await archiveProjectAction("not-a-uuid")).toEqual({ ok: false, error: PROJECT_MESSAGES.notFound });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("restoreProjectAction", () => {
  it("restores an archived project", async () => {
    const { client, builders } = fakeClient([{ data: [{ id: PROJECT }], error: null }]);
    state.client = client;
    expect(await restoreProjectAction(PROJECT)).toEqual({ ok: true });
    expect(builders[0].update).toHaveBeenCalledWith({ archived_at: null });
    expect(builders[0].not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("reports missing rights when no row was updated", async () => {
    state.client = fakeClient([{ data: [], error: null }]).client;
    expect(await restoreProjectAction(PROJECT)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
  });
});

describe("deleteProjectAction", () => {
  const archived = { data: { name: NAME, archived_at: "2026-10-08T10:00:00Z" }, error: null };
  const deleted = { data: [{ id: PROJECT }], error: null };

  it("removes files in batches, then deletes the project", async () => {
    const { client, builders, remove } = fakeClient(
      [archived, deleted],
      [
        { data: [path(1), path(2)], error: null },
        { data: [path(3)], error: null },
        { data: [], error: null },
      ],
      [
        { data: [{ name: "1" }, { name: "2" }], error: null },
        { data: [{ name: "3" }], error: null },
      ],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, `  ${NAME} `)).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("project_attachment_paths", { p_project_id: PROJECT });
    expect(remove).toHaveBeenNthCalledWith(1, [path(1), path(2)]);
    expect(remove).toHaveBeenNthCalledWith(2, [path(3)]);
    expect(builders[1].delete).toHaveBeenCalled();
    expect(builders[1].eq).toHaveBeenCalledWith("id", PROJECT);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("refuses when the name does not match", async () => {
    const { client, remove } = fakeClient([archived]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, "старый цех")).toEqual({
      ok: false,
      error: PROJECT_MESSAGES.nameMismatch,
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("refuses an active project", async () => {
    const { client } = fakeClient([{ data: { name: NAME, archived_at: null }, error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.notArchived });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses a project the user cannot see", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.notArchived });
  });

  it("keeps the project when Storage fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(
      [archived],
      [{ data: [path(1)], error: null }],
      [{ data: null, error: { message: "boom" } }],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("keeps the project when Storage removed only part of the batch", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient(
      [archived],
      [{ data: [path(1), path(2)], error: null }],
      [{ data: [{ name: "1" }], error: null }],
    );
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("keeps the project when the path lookup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, remove } = fakeClient([archived], [{ data: null, error: { message: "boom" } }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.deleteFailed });
    expect(remove).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("reports missing rights when the delete matched no row", async () => {
    const { client } = fakeClient([archived, { data: [], error: null }]);
    state.client = client;
    expect(await deleteProjectAction(PROJECT, NAME)).toEqual({ ok: false, error: PROJECT_MESSAGES.ownerOnly });
  });
});
```

- [ ] **Step 3: Запустить — падают**

Run: `npx vitest run lib/business/project-archive.test.ts "app/(app)/projects/actions.test.ts"`
Expected: FAIL — нет модуля `./project-archive`; нет `PROJECT_MESSAGES` / экспортов действий.

- [ ] **Step 4: Реализация**

`lib/business/project-archive.ts`:

```ts
// Подтверждение удаления проекта навсегда
// (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md §3):
// введённое название совпадает с названием проекта после trim, с учётом регистра.
// Используется и в форме (активность кнопки), и в server action.
export function confirmsProjectName(input: string, name: string): boolean {
  const typed = input.trim();
  return typed !== "" && typed === name.trim();
}
```

В конец `lib/errors.ts`:

```ts
// Архив и удаление проекта (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md §5).
export const PROJECT_MESSAGES = {
  notFound: "Проект не найден. Обновите страницу.",
  ownerOnly: "Отправить в архив, вернуть или удалить проект может только его владелец.",
  archiveFailed: "Не удалось отправить проект в архив. Попробуйте ещё раз.",
  restoreFailed: "Не удалось вернуть проект из архива. Попробуйте ещё раз.",
  notArchived: "Удалить можно только проект в архиве.",
  nameMismatch: "Название не совпадает.",
  deleteFailed: "Не удалось удалить проект. Попробуйте ещё раз.",
} as const;
```

`app/(app)/projects/actions.ts` — импорты заменить и добавить действия после `createProjectAction`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ATTACHMENTS_BUCKET } from "@/lib/business/attachments";
import { confirmsProjectName } from "@/lib/business/project-archive";
import { PROJECT_MESSAGES } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { uuidSchema } from "@/lib/validation/members";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";
```

```ts
// Архив и удаление (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md §5).
// Права гарантирует RLS (projects_update / projects_delete — только владелец,
// удаление — только архивного); 0 изменённых строк = нет прав.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Защита от бесконечного цикла: 100 пачек по 1000 файлов. */
const MAX_FILE_BATCHES = 100;

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId)
    .is("archived_at", null)
    .select("id");

  if (error) {
    console.error("archiveProjectAction:", error);
    return { ok: false, error: PROJECT_MESSAGES.archiveFailed };
  }
  if (!data || data.length === 0) return { ok: false, error: PROJECT_MESSAGES.ownerOnly };

  revalidatePath("/projects");
  redirect("/projects");
}

export async function restoreProjectAction(projectId: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: null })
    .eq("id", projectId)
    .not("archived_at", "is", null)
    .select("id");

  if (error) {
    console.error("restoreProjectAction:", error);
    return { ok: false, error: PROJECT_MESSAGES.restoreFailed };
  }
  if (!data || data.length === 0) return { ok: false, error: PROJECT_MESSAGES.ownerOnly };

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProjectAction(projectId: string, confirmName: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: PROJECT_MESSAGES.notFound };

  const supabase = await createClient();
  const { data: project, error: readError } = await supabase
    .from("projects")
    .select("name, archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (readError) {
    console.error("deleteProjectAction (read):", readError);
    return { ok: false, error: PROJECT_MESSAGES.deleteFailed };
  }
  if (!project || !project.archived_at) return { ok: false, error: PROJECT_MESSAGES.notArchived };
  if (!confirmsProjectName(String(confirmName ?? ""), project.name)) {
    return { ok: false, error: PROJECT_MESSAGES.nameMismatch };
  }

  // Сначала файлы: после удаления строки проекта RLS storage.objects их не отдаст.
  if (!(await removeProjectFiles(supabase, projectId))) {
    return { ok: false, error: PROJECT_MESSAGES.deleteFailed };
  }

  const { data, error } = await supabase.from("projects").delete().eq("id", projectId).select("id");
  if (error) {
    console.error("deleteProjectAction (delete):", error);
    return { ok: false, error: PROJECT_MESSAGES.deleteFailed };
  }
  if (!data || data.length === 0) return { ok: false, error: PROJECT_MESSAGES.ownerOnly };

  revalidatePath("/projects");
  return { ok: true };
}

/** Удаляет все файлы архивного проекта пачками; false — остановлено, проект трогать нельзя. */
async function removeProjectFiles(supabase: Supabase, projectId: string): Promise<boolean> {
  const bucket = supabase.storage.from(ATTACHMENTS_BUCKET);

  for (let batch = 0; batch < MAX_FILE_BATCHES; batch++) {
    const { data: paths, error } = await supabase.rpc("project_attachment_paths", { p_project_id: projectId });
    if (error) {
      console.error("deleteProjectAction (paths):", error);
      return false;
    }
    if (!paths || paths.length === 0) return true;

    const { data: removed, error: removeError } = await bucket.remove(paths);
    if (removeError || (removed?.length ?? 0) < paths.length) {
      console.error("deleteProjectAction (storage):", removeError ?? `removed ${removed?.length ?? 0} of ${paths.length}`);
      return false;
    }
  }

  console.error("deleteProjectAction: too many file batches", projectId);
  return false;
}
```

- [ ] **Step 5: Прогнать**

Run: `npx vitest run lib/business/project-archive.test.ts "app/(app)/projects/actions.test.ts" && npx tsc --noEmit && echo TSC_OK && npx eslint lib "app/(app)/projects" && echo LINT_OK`
Expected: 4 + 14 passed, `TSC_OK`, `LINT_OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/business/project-archive.ts lib/business/project-archive.test.ts lib/errors.ts "app/(app)/projects/actions.ts" "app/(app)/projects/actions.test.ts"
git commit -m "feat(projects): действия архива, возврата и удаления проекта"
```

---

### Task 3: Интерфейс — «Архив» в настройках и раздел архива в списке проектов

**Files:**
- Create: `app/(app)/[projectId]/settings/archive-project-section.tsx`
- Modify: `app/(app)/[projectId]/settings/page.tsx`
- Create: `app/(app)/projects/archived-projects.tsx`
- Modify: `app/(app)/projects/page.tsx`

**Interfaces:**
- Consumes: `archiveProjectAction`, `restoreProjectAction`, `deleteProjectAction` (Task 2); `confirmsProjectName` (Task 2); `canManageProject` (`lib/business/project-roles.ts`).

Компонентных тестов в проекте нет (vitest `environment: "node"`); логика — в Task 2, здесь проверка в браузере.

- [ ] **Step 1: Карточка «Архив» в настройках**

`app/(app)/[projectId]/settings/archive-project-section.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { archiveProjectAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";

export function ArchiveProjectSection({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  const archive = () => {
    if (!window.confirm("Отправить проект в архив? Он пропадёт у всех участников.")) return;
    startTransition(async () => {
      // При успехе действие делает redirect() на список проектов.
      const result = await archiveProjectAction(projectId);
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-muted">
        Проект пропадёт у всех участников. Данные сохранятся — вернуть проект можно в разделе «Архив»
        списка проектов.
      </p>
      <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={archive}>
        Отправить в архив
      </Button>
    </div>
  );
}
```

В `app/(app)/[projectId]/settings/page.tsx` импорт `import { ArchiveProjectSection } from "./archive-project-section";` (по алфавиту перед `MembersSection`) и после `<MembersSection … />`:

```tsx
      {canManageProject(role) ? (
        <Card>
          <CardHeader>
            <CardTitle>Архив</CardTitle>
          </CardHeader>
          <CardContent>
            <ArchiveProjectSection projectId={projectId} />
          </CardContent>
        </Card>
      ) : null}
```

- [ ] **Step 2: Раздел архива на `/projects`**

`app/(app)/projects/archived-projects.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmsProjectName } from "@/lib/business/project-archive";

import { deleteProjectAction, restoreProjectAction } from "./actions";

export type ArchivedProject = { id: string; name: string };

/** Архивные проекты владельца: вернуть или удалить навсегда (spec 2026-10-08 §3). */
export function ArchivedProjects({ projects }: { projects: ArchivedProject[] }) {
  if (projects.length === 0) return null;

  return (
    <details className="flex flex-col">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-meta select-none">
        Архив ({projects.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {projects.map((project) => (
          <ArchivedProjectRow key={project.id} project={project} />
        ))}
      </ul>
    </details>
  );
}

function ArchivedProjectRow({ project }: { project: ArchivedProject }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmed = confirmsProjectName(typed, project.name);
  const inputId = `delete-confirm-${project.id}`;

  const restore = () => {
    startTransition(async () => {
      const result = await restoreProjectAction(project.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Проект возвращён из архива.");
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteProjectAction(project.id, typed);
      if (!result.ok) toast.error(result.error);
      else toast.success("Проект удалён.");
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line-strong px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-medium text-ink-muted">{project.name}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="xs" disabled={pending} onClick={restore}>
            Вернуть
          </Button>
          <Button
            variant="destructive"
            size="xs"
            disabled={pending}
            aria-expanded={confirming}
            aria-controls={inputId}
            onClick={() => {
              setConfirming((open) => !open);
              setTyped("");
            }}
          >
            Удалить навсегда
          </Button>
        </div>
      </div>

      {confirming ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) remove();
          }}
        >
          <Label htmlFor={inputId} className="text-[12px] font-normal text-status-alert-fg">
            Будут удалены все заявки, материалы, списки и фото проекта. Это необратимо. Введите название
            проекта:
          </Label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            disabled={pending}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button type="submit" variant="destructive" size="sm" className="self-start" disabled={pending || !confirmed}>
            Удалить навсегда
          </Button>
        </form>
      ) : null}
    </li>
  );
}
```

В `app/(app)/projects/page.tsx`: импорт `import { ArchivedProjects } from "./archived-projects";` (перед `CreateProjectForm`), запрос активных и архивных параллельно:

```ts
  const [{ data: projects }, { data: archived }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, timezone, project_members(role)")
      .eq("project_members.user_id", user?.id ?? "")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    // Архив видит только владелец — и только свои проекты.
    supabase
      .from("projects")
      .select("id, name")
      .eq("owner_id", user?.id ?? "")
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
  ]);
```

(комментарий «Встроенный фильтр ограничивает project_members…» оставить над первым запросом), и внутри первого `<div className="flex flex-col gap-2">` после условного списка/`EmptyState`:

```tsx
        <ArchivedProjects projects={archived ?? []} />
```

- [ ] **Step 3: Проверка типов и lint**

Run: `npx tsc --noEmit && echo TSC_OK && npx eslint "app/(app)/projects" "app/(app)/[projectId]/settings" && echo LINT_OK`
Expected: `TSC_OK`, `LINT_OK`.

- [ ] **Step 4: Браузер (локально, `preview_start` `dev`)**

1. На `/projects` создать проект «Архив QA» (форма «Новый проект»); в нём — материал «Электрод QA» (кг, остаток 10), заявку «Заявка QA» с расходом 2 кг и одним фото (в скрытой панели — JPEG через `canvas.toBlob` + `DataTransfer` в `input[type=file]`).
2. Настройки проекта → «Архив» → «Отправить в архив» (`window.confirm` в скрытой панели подменить на `() => true` на время клика) → переход на `/projects`; проекта нет среди активных, есть в «Архив (1)»; прямая ссылка на проект — 404.
3. «Вернуть» → проект снова среди активных. Снова отправить в архив.
4. «Удалить навсегда» → ввести «архив qa» — кнопка неактивна; ввести «Архив QA» → удалить → toast «Проект удалён.», раздел «Архив» исчез.
5. psql (`set statement_timeout='5s'`): по id проекта 0 строк в `projects`, `tasks`, `materials`, `material_movements`, `task_attachments`; `select count(*) from storage.objects where name like '<id>/%'` → 0.
6. Консоль без новых ошибок; `preview_logs` без `deleteProjectAction` / `archiveProjectAction`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/[projectId]/settings/archive-project-section.tsx" "app/(app)/[projectId]/settings/page.tsx" "app/(app)/projects/archived-projects.tsx" "app/(app)/projects/page.tsx"
git commit -m "feat(projects): архив проекта в настройках и раздел архива в списке проектов"
```

---

### Task 4: Документация и финальная проверка

**Files:**
- Modify: `docs/product-requirements.md`, `docs/database.md`, `docs/architecture.md`, `docs/roadmap.md`

- [ ] **Step 1: product-requirements.md.** В §4.8 «Проекты» после списка про приглашения — подраздел:

```markdown
Архив и удаление (2026-10-08):

* Владелец отправляет проект в архив в настройках. Проект пропадает у всех участников (список, прямые ссылки), данные сохраняются, приглашение в него принять нельзя.
* В списке проектов владелец видит раздел «Архив»: «Вернуть» или «Удалить навсегда».
* Удалить можно только проект в архиве и только после ввода его названия. Удаляются все данные проекта и фото; действие необратимо.
```

- [ ] **Step 2: database.md.**
  - §5.2 `projects`, строка RLS: «UPDATE — только владельцу. DELETE — только владельцу и только проекта в архиве (`archived_at is not null`, 0027).»
  - §5.11 `material_movements` — абзац: «Каскадное удаление проекта (0027): триггер `apply_task_material_change` при DELETE строки `task_materials` удалённого проекта не меняет остаток и не пишет движение — журнал и материалы удаляет тот же каскад. Удаление расхода в живом проекте пишет `adjustment`, как прежде.»
  - В таблицу RPC после `task_attachment_orphans` — строка: `` | `project_attachment_paths(p_project_id, p_limit default 1000)` (0027) | пути всех файлов проекта в bucket `task-attachments` для удаления через Storage API перед удалением проекта; только владельцу и только для проекта в архиве, иначе пусто; порядок `name`, предел 1–1000; `language sql stable`, security invoker | ``
  - В список миграций: `27. `0027_project_archive_delete` — удаление проекта только из архива (политика `projects_delete`), ранний выход триггера расхода при каскаде, RPC `project_attachment_paths`.`

- [ ] **Step 3: architecture.md.** После §3.2 — новый подраздел:

```markdown
### 3.3 Архив и удаление проекта

Действия — `app/(app)/projects/actions.ts`: `archiveProjectAction` (карточка «Архив» в настройках), `restoreProjectAction` и `deleteProjectAction` (раздел «Архив» на `/projects`, только проекты владельца). Удаление навсегда: проверка архива и названия (`confirmsProjectName`, `lib/business/project-archive.ts`) → файлы пачками по 1000 (RPC `project_attachment_paths` → `storage.remove`; ошибка или неполное удаление — стоп, проект не трогается) → `delete from projects` под RLS, остальное — каскад. Файлы удаляются первыми: после удаления проекта RLS `storage.objects` их не отдаст. Service role не используется.
```

- [ ] **Step 4: roadmap.md.**
  - П. 11 заменить: `11. ~~Удаление проекта с его файлами в Storage~~ — сделано (0027, 2026-10-08): архив, удаление навсегда из архива вместе с фото.`
  - В «Открытых вопросах» строку «Удаление проекта с расходом материалов падает…» заменить на: `| Удаление проекта с расходом материалов падало (триггер писал движение в удаляемый проект). Решено (0027): проект сначала уходит в архив, удаляется навсегда только из архива; триггер при каскаде ничего не пишет. | Решено |`

- [ ] **Step 5: Полная проверка**

Run: `npx tsc --noEmit && npx eslint . && npm test && supabase test db && npm run build`
Expected: всё зелёное (vitest 217 + 18 = 235, pgTAP 319), сборка успешна.

Run: `supabase db push --dry-run`
Expected: к отправке только `0027_project_archive_delete.sql`.

- [ ] **Step 6: Commit**

```bash
git add docs/product-requirements.md docs/database.md docs/architecture.md docs/roadmap.md
git commit -m "docs: архив и удаление проектов (п. 11)"
```
