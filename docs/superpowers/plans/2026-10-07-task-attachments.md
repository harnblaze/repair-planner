# Фото к задачам — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** мастер прикладывает к заявке фото с телефона (сжатые в браузере JPEG ≤ 2000 px), смотрит их в полноэкранном просмотре и удаляет; доступ защищён RLS на таблице и на Storage.

**Architecture:** приватный bucket `task-attachments` с RLS на `storage.objects` по первой папке пути (`project_id`) и таблица `task_attachments` с RLS по членству в проекте. Загрузка идёт в три шага: server action выдаёт signed upload URL на путь, выбранный сервером; браузер отправляет сжатый JPEG `PUT`-запросом прямо в Storage; второй server action проверяет объект и вставляет строку. Просмотр — через подписанные на час ссылки, созданные на сервере.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres RLS, Storage, `@supabase/supabase-js` 2.116), Tailwind, `@base-ui/react` Dialog, `lucide-react`, `sonner`, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-07-task-attachments-design.md`

## Global Constraints

- Ответы и отчёты пользователю — на русском. После каждой задачи остановиться и отчитаться разделами «Что сделано / Изменения / Проверка / Проблемы / решения / Следующий шаг» (CLAUDE.md §38, §42).
- Коммит — только после краткого описания изменений и явного «да» пользователя (CLAUDE.md §39). Опасные git-операции запрещены.
- Никогда не запускать `supabase db reset`. Локальные миграции применяются через `supabase migration up --local`.
- Production-миграции — только после явного подтверждения: `supabase db push --dry-run`, затем `supabase db push`.
- Без service role key. Секреты не выводить.
- Без новых npm-зависимостей.
- Новые функции в `public`/`private`: `revoke all ... from public, anon` и явный `grant ... to authenticated`.
- Bucket: `task-attachments`, приватный, `file_size_limit = 10485760` (10 МБ), `allowed_mime_types = {image/jpeg}`.
- Путь объекта: `{project_id}/{task_id}/{uuid}.jpg`. Путь выбирает только сервер.
- Сжатие: длинная сторона ≤ 2000 px, JPEG, качество 0.85. Исходник ≤ 40 МБ. Лимит — 30 фото на задачу (мягкий). Подписанная ссылка на просмотр живёт 3600 с.
- Удаление: сначала строка (`storage_path` берётся из удалённой строки), потом файл (best-effort, ошибка только в лог).
- Тексты ошибок для пользователя — из спеки §8; технические детали — только в `console.error`.
- Next.js 16 отличается от того, что знает модель: перед кодом Next прочитать нужный раздел `node_modules/next/dist/docs/` (AGENTS.md).

## Review Focus

1. **Повторный confirm того же пути** (двойной клик, повтор после таймаута сети). Ожидается `ok: true`, файл не удаляется, дубля строки нет. Тест — Task 3, «treats a repeated confirm of the same path as success».
2. **Имя объекта Storage с мусорной первой папкой** (`not-a-uuid/x.jpg`). Ожидается отказ RLS (`42501`), а не ошибка приведения к `uuid` (`22P02`). Тест — Task 2, pgTAP №12.
3. **Вкладка открыта больше часа**, подписанные ссылки истекли. Ожидается заглушка «Обновите страницу» вместо битой картинки — и в сетке, и в просмотре. Проверка — Task 4, шаг ручной проверки «истёкшая ссылка».
4. **Viewer или участник, у которого отобрали права, пока страница открыта.** Ожидается, что сервер отказывает понятным сообщением и Storage тоже не пускает. Тесты — Task 2 (pgTAP №20–23) и Task 3 («returns the access error without touching Supabase»).
5. **В пачке из нескольких файлов один не декодируется** (HEIC на десктопе) или слишком большой. Ожидается, что остальные загружаются, а в итоге одно сообщение «Не удалось загрузить N фото из M. <причина>». Тесты — Task 1 (`formatUploadErrors`) и Task 4 (ручная проверка с не-изображением в пачке).

---

## Карта файлов

| Файл | Действие | Ответственность |
|---|---|---|
| `lib/business/attachments.ts` | создать | константы и чистые функции: размеры, путь, валидация |
| `lib/business/attachments.test.ts` | создать | vitest для них |
| `lib/errors.ts` | изменить (в конец) | `ATTACHMENT_MESSAGES`, `formatUploadErrors` |
| `lib/errors.test.ts` | изменить (в конец) | тесты `formatUploadErrors` |
| `supabase/migrations/0017_task_attachments.sql` | создать | таблица, RLS, bucket, helper, политики `storage.objects` |
| `supabase/tests/database/attachments.test.sql` | создать | pgTAP для 0017 (отдельный файл, `plan(28)`) |
| `lib/types/database.ts` | перегенерировать | типы с `task_attachments` |
| `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts` | создать | три server actions. Отдельный файл: `actions.ts` уже 15 КБ — отступление от таблицы спеки §9, ответственность та же |
| `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts` | создать | vitest с фейковым клиентом Supabase |
| `lib/attachments/compress-image.ts` | создать | сжатие в браузере (canvas → Blob) |
| `app/(app)/[projectId]/tasks/[taskId]/task-attachments.tsx` | создать | UI: сетка, загрузка, просмотр, удаление |
| `app/(app)/[projectId]/tasks/[taskId]/page.tsx` | изменить | чтение строк и подписанных ссылок, вставка блока |
| `docs/database.md`, `docs/architecture.md`, `docs/roadmap.md` | изменить | документация |

---

### Task 1: Константы, чистые функции и сообщения об ошибках

**Files:**
- Create: `lib/business/attachments.ts`
- Create: `lib/business/attachments.test.ts`
- Modify: `lib/errors.ts` (добавить в конец файла)
- Modify: `lib/errors.test.ts` (импорт в строке 2 и новый `describe` в конце)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `ATTACHMENTS_BUCKET = "task-attachments"`, `MAX_ATTACHMENTS_PER_TASK = 30`, `MAX_SOURCE_BYTES = 41943040`, `MAX_SIDE = 2000`, `JPEG_QUALITY = 0.85`, `SIGNED_URL_TTL_SECONDS = 3600`;
  - `fitWithin(width: number, height: number, maxSide: number): { width: number; height: number }`;
  - `buildAttachmentPath(projectId: string, taskId: string, fileId: string): string`;
  - `isValidAttachmentPath(path: string, projectId: string, taskId: string): boolean`;
  - `isValidDimension(value: unknown): value is number`;
  - в `lib/errors.ts`: `ATTACHMENT_MESSAGES` с ключами `uploadFailed`, `limitReached`, `unsupported`, `tooLarge`, `taskNotFound`, `notFound`, `deleteFailed`; функция `formatUploadErrors(errors: string[], total: number): string | null`.

- [ ] **Step 1: Написать падающие тесты для `lib/business/attachments.ts`**

```ts
import { describe, expect, it } from "vitest";

import {
  buildAttachmentPath,
  fitWithin,
  isValidAttachmentPath,
  isValidDimension,
  MAX_SIDE,
} from "./attachments";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK = "e0000000-0000-0000-0000-00000000000a";
const FILE = "f0000000-0000-4000-8000-000000000001";

describe("fitWithin", () => {
  it("scales a landscape photo down to the max side", () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("scales a portrait photo down to the max side", () => {
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("keeps a small photo as is (never upscales)", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it("scales a square photo", () => {
    expect(fitWithin(2500, 2500, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it("never returns a zero side for extreme panoramas", () => {
    expect(fitWithin(1, 10000, 2000)).toEqual({ width: 1, height: 2000 });
  });
});

describe("buildAttachmentPath / isValidAttachmentPath", () => {
  it("builds {project}/{task}/{uuid}.jpg", () => {
    expect(buildAttachmentPath(PROJECT, TASK, FILE)).toBe(`${PROJECT}/${TASK}/${FILE}.jpg`);
  });

  it("accepts a path built for the same task", () => {
    expect(isValidAttachmentPath(buildAttachmentPath(PROJECT, TASK, FILE), PROJECT, TASK)).toBe(true);
  });

  it("rejects a path of another task", () => {
    const other = "e0000000-0000-0000-0000-00000000000b";
    expect(isValidAttachmentPath(buildAttachmentPath(PROJECT, other, FILE), PROJECT, TASK)).toBe(false);
  });

  it("rejects a path of another project", () => {
    const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(isValidAttachmentPath(buildAttachmentPath(other, TASK, FILE), PROJECT, TASK)).toBe(false);
  });

  it("rejects traversal, extra segments and other extensions", () => {
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/../x/${FILE}.jpg`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/sub/${FILE}.jpg`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/${FILE}.png`, PROJECT, TASK)).toBe(false);
    expect(isValidAttachmentPath(`${PROJECT}/${TASK}/photo.jpg`, PROJECT, TASK)).toBe(false);
  });
});

describe("isValidDimension", () => {
  it("accepts integers from 1 to MAX_SIDE", () => {
    expect(isValidDimension(1)).toBe(true);
    expect(isValidDimension(MAX_SIDE)).toBe(true);
  });

  it("rejects zero, fractions, oversize and non-numbers", () => {
    expect(isValidDimension(0)).toBe(false);
    expect(isValidDimension(10.5)).toBe(false);
    expect(isValidDimension(MAX_SIDE + 1)).toBe(false);
    expect(isValidDimension("100")).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run lib/business/attachments.test.ts`
Expected: FAIL — `Failed to resolve import "./attachments"`.

- [ ] **Step 3: Реализовать `lib/business/attachments.ts`**

```ts
// Фото к задачам: константы и чистые функции, общие для браузера и сервера
// (docs/superpowers/specs/2026-10-07-task-attachments-design.md).

export const ATTACHMENTS_BUCKET = "task-attachments";
/** Мягкий лимит: проверяется перед выдачей ссылки на загрузку. */
export const MAX_ATTACHMENTS_PER_TASK = 30;
/** Исходник до сжатия: больше — телефон может не справиться с декодированием. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.85;
export const SIGNED_URL_TTL_SECONDS = 3600;

const FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Размеры после уменьшения до maxSide по длинной стороне; маленькие фото не увеличиваются. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= maxSide && height <= maxSide) {
    return { width, height };
  }
  const scale = maxSide / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function buildAttachmentPath(projectId: string, taskId: string, fileId: string): string {
  return `${projectId}/${taskId}/${fileId}.jpg`;
}

/** Путь ровно вида {projectId}/{taskId}/{uuid}.jpg — без лишних сегментов и `..`. */
export function isValidAttachmentPath(path: string, projectId: string, taskId: string): boolean {
  const prefix = `${projectId}/${taskId}/`;
  return path.startsWith(prefix) && FILE_NAME_RE.test(path.slice(prefix.length));
}

export function isValidDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
}
```

- [ ] **Step 4: Запустить тесты — проходят**

Run: `npx vitest run lib/business/attachments.test.ts`
Expected: PASS (все тесты зелёные).

- [ ] **Step 5: Написать падающие тесты для `formatUploadErrors`**

В `lib/errors.test.ts` заменить строку 2 на:

```ts
import { ATTACHMENT_MESSAGES, formatUploadErrors, mapAuthError, mapBoardMoveError, NOT_WORKING_DAY_MESSAGE } from "@/lib/errors";
```

и добавить в конец файла:

```ts
describe("formatUploadErrors", () => {
  it("returns null when every photo was uploaded", () => {
    expect(formatUploadErrors([], 3)).toBeNull();
  });

  it("returns the reason itself for a single photo", () => {
    expect(formatUploadErrors([ATTACHMENT_MESSAGES.tooLarge], 1)).toBe(ATTACHMENT_MESSAGES.tooLarge);
  });

  it("counts failures and shows the first specific reason", () => {
    expect(
      formatUploadErrors([ATTACHMENT_MESSAGES.uploadFailed, ATTACHMENT_MESSAGES.unsupported], 5),
    ).toBe(`Не удалось загрузить 2 фото из 5. ${ATTACHMENT_MESSAGES.unsupported}`);
  });

  it("does not repeat the generic text when there is no specific reason", () => {
    expect(formatUploadErrors([ATTACHMENT_MESSAGES.uploadFailed], 3)).toBe(
      "Не удалось загрузить 1 фото из 3. Попробуйте ещё раз.",
    );
  });
});
```

- [ ] **Step 6: Запустить и убедиться, что тесты падают**

Run: `npx vitest run lib/errors.test.ts`
Expected: FAIL — `formatUploadErrors is not a function` (или ошибка импорта `ATTACHMENT_MESSAGES`).

- [ ] **Step 7: Добавить в конец `lib/errors.ts`**

Импорт — в начало файла (сейчас в файле импортов нет):

```ts
import { MAX_ATTACHMENTS_PER_TASK } from "@/lib/business/attachments";
```

В конец файла:

```ts
// Фото к задачам (docs/superpowers/specs/2026-10-07-task-attachments-design.md §8).
// Нет прав — общий NO_EDIT_ACCESS_MESSAGE из lib/projects/access.ts.
export const ATTACHMENT_MESSAGES = {
  uploadFailed: "Не удалось загрузить фото. Попробуйте ещё раз.",
  limitReached: `У задачи уже ${MAX_ATTACHMENTS_PER_TASK} фото — удалите лишние.`,
  unsupported: "Этот формат фото не поддерживается. Сохраните его как JPEG.",
  tooLarge: "Фото слишком большое.",
  taskNotFound: "Заявка не найдена. Обновите страницу.",
  notFound: "Фото не найдено. Обновите страницу.",
  deleteFailed: "Не удалось удалить фото. Попробуйте ещё раз.",
} as const;

/**
 * Итог загрузки нескольких фото одним сообщением. Загруженные фото остаются;
 * показывается число неудач и первая конкретная причина.
 */
export function formatUploadErrors(errors: string[], total: number): string | null {
  if (errors.length === 0) return null;
  if (total === 1) return errors[0];
  const reason = errors.find((error) => error !== ATTACHMENT_MESSAGES.uploadFailed);
  return `Не удалось загрузить ${errors.length} фото из ${total}. ${reason ?? "Попробуйте ещё раз."}`;
}
```

- [ ] **Step 8: Запустить тесты — проходят**

Run: `npx vitest run lib/errors.test.ts lib/business/attachments.test.ts`
Expected: PASS.

- [ ] **Step 9: Проверка типов и линтера**

Run: `npx tsc --noEmit && npx eslint lib/business/attachments.ts lib/business/attachments.test.ts lib/errors.ts lib/errors.test.ts`
Expected: без ошибок.

- [ ] **Step 10: Отчёт и коммит после подтверждения**

```bash
git add lib/business/attachments.ts lib/business/attachments.test.ts lib/errors.ts lib/errors.test.ts
git commit -m "feat: константы и проверки для фото к задачам"
```

---

### Task 2: Миграция 0017 и pgTAP

**Files:**
- Create: `supabase/tests/database/attachments.test.sql`
- Create: `supabase/migrations/0017_task_attachments.sql`
- Regenerate: `lib/types/database.ts`

**Interfaces:**
- Consumes: `public.project_access(uuid)` (возвращает `project_role` или null), `public.project_can_edit(uuid)` (boolean), составной уникальный ключ `tasks (id, project_id)`.
- Produces:
  - таблица `public.task_attachments(id, project_id, task_id, storage_path, size_bytes, width, height, created_by, created_at)`;
  - bucket `task-attachments`;
  - функция `private.attachment_project_id(text) returns uuid`;
  - политики `task_attachments_objects_{select,insert,delete}` на `storage.objects`;
  - тип `Database["public"]["Tables"]["task_attachments"]` в `lib/types/database.ts`.

- [ ] **Step 1: Написать pgTAP-тест `supabase/tests/database/attachments.test.sql`**

```sql
-- Фото к задачам (0017): RLS таблицы task_attachments и storage.objects
-- в bucket task-attachments. Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(28);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец проекта A, B — владелец проекта B, C — viewer в A, D — member в A.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'att-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'att-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'att-viewer-c@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'att-member-d@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Project B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.tasks (id, project_id, title) values
  ('e1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A'),
  ('e1000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Task A2'),
  ('e1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Task B');

-- ================= Bucket =================

-- 1-3
select is((select public from storage.buckets where id = 'task-attachments'), false, 'bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'task-attachments'), array['image/jpeg']::text[], 'bucket accepts only image/jpeg');
select is((select file_size_limit from storage.buckets where id = 'task-attachments'), 10485760::bigint, 'bucket limits files to 10 MB');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 4. Строка для своей задачи
select lives_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001.jpg',
      1000, 2000, 1500) $$,
  'owner inserts an attachment row for own task'
);

-- 5. Путь другой задачи того же проекта отклоняется CHECK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-0000000000a2/f0000000-0000-0000-0000-000000000002.jpg',
      1000, 10, 10) $$,
  '23514', null,
  'storage_path of another task is rejected by the check constraint'
);

-- 6. Путь не вида {uuid}.jpg отклоняется CHECK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/../x.jpg',
      1000, 10, 10) $$,
  '23514', null,
  'storage_path with extra segments is rejected by the check constraint'
);

-- 7. Задача проекта B под project_id A — составной FK
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000b',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000003.jpg',
      1000, 10, 10) $$,
  '23503', null,
  'cross-project task_id is rejected by the composite foreign key'
);

-- 8. Строка в чужом проекте — RLS
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e1000000-0000-0000-0000-00000000000b',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000004.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'owner A cannot insert an attachment into project B'
);

-- 9. UPDATE строк запрещён (политики нет)
with upd as (
  update public.task_attachments set width = 1
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from upd), 0::bigint, 'attachment rows cannot be updated');

-- 10. Объект Storage в своём проекте
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000001.jpg') $$,
  'owner uploads an object into own project folder'
);

-- 11. Объект в папке чужого проекта
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/e1000000-0000-0000-0000-00000000000b/f0000000-0000-0000-0000-000000000005.jpg') $$,
  '42501', null,
  'owner A cannot upload into project B folder'
);

-- 12. Мусорная первая папка — отказ RLS, а не ошибка приведения к uuid
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('task-attachments', 'not-a-uuid/x.jpg') $$,
  '42501', null,
  'object with a non-uuid first folder is denied, not a cast error'
);

-- 13. UPDATE объектов запрещён (политики нет)
with upd as (
  update storage.objects set name = name || '.moved'
    where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from upd), 0::bigint, 'attachment objects cannot be updated');

-- ================= Пользователь B: нет доступа к проекту A =================

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
select set_config('storage.allow_delete_query', 'true', true) as _;
set role authenticated;

-- 14-17
select is(
  (select count(*) from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint, 'user B cannot see attachment rows of project A'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'task-attachments'),
  0::bigint, 'user B cannot see attachment objects of project A'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'user B cannot delete attachment rows of project A');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 0::bigint, 'user B cannot delete attachment objects of project A');

-- ================= Viewer C: только чтение =================

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
set role authenticated;

-- 18-23
select is(
  (select count(*) from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint, 'viewer sees attachment rows'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'task-attachments'),
  1::bigint, 'viewer sees attachment objects'
);
select throws_ok(
  $$ insert into public.task_attachments (project_id, task_id, storage_path, size_bytes, width, height) values
     ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000a',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000006.jpg',
      1000, 10, 10) $$,
  '42501', null,
  'viewer cannot insert attachment rows'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000006.jpg') $$,
  '42501', null,
  'viewer cannot upload attachment objects'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete attachment rows');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 0::bigint, 'viewer cannot delete attachment objects');

-- ================= Member D: редактирует =================

reset role;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;
set role authenticated;

-- 24-26
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
     ('task-attachments', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/e1000000-0000-0000-0000-0000000000a2/f0000000-0000-0000-0000-000000000007.jpg') $$,
  'member uploads an object into the project folder'
);
with del as (
  delete from public.task_attachments where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*) from del), 1::bigint, 'member deletes attachment rows');
with del as (
  delete from storage.objects where bucket_id = 'task-attachments' returning id
)
select is((select count(*) from del), 2::bigint, 'member deletes attachment objects');

-- ================= anon и права на helper =================

reset role;
set role anon;

-- 27
select is((select count(*) from public.task_attachments), 0::bigint, 'anon sees no attachment rows');

reset role;

-- 28
select ok(
  not has_function_privilege('anon', 'private.attachment_project_id(text)', 'execute'),
  'anon cannot execute private.attachment_project_id'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `supabase test db`
Expected: FAIL в `attachments.test.sql` — `relation "public.task_attachments" does not exist`. `rls.test.sql` остаётся зелёным (142/142).

- [ ] **Step 3: Написать миграцию `supabase/migrations/0017_task_attachments.sql`**

```sql
-- Фото к задачам (docs/superpowers/specs/2026-10-07-task-attachments-design.md).
--
-- Файлы лежат в приватном bucket task-attachments по пути
-- {project_id}/{task_id}/{uuid}.jpg; путь выбирает сервер. Доступ — двумя
-- слоями: RLS таблицы task_attachments (по проекту, связь с задачей через
-- составной FK и CHECK пути) и RLS storage.objects (по первой папке пути).
-- Service role не используется.

-- ================= Таблица =================

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid not null,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  -- Путь принадлежит именно этой задаче этого проекта и имеет вид {uuid}.jpg.
  constraint task_attachments_path_matches_task check (
    storage_path ~ ('^' || project_id::text || '/' || task_id::text
                    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
);

create index if not exists task_attachments_task_idx
  on public.task_attachments (task_id, created_at);

-- ================= RLS таблицы =================
-- SELECT — любой участник; INSERT/DELETE — owner, member; UPDATE — никто.

alter table public.task_attachments enable row level security;

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments
  for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments
  for insert to authenticated
  with check (public.project_can_edit(project_id));

drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments
  for delete to authenticated
  using (public.project_can_edit(project_id));

-- ================= Bucket =================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ================= RLS storage.objects =================

-- project_id из первой папки пути или null, если это не uuid. Приведение
-- внутри CASE: некорректное имя даёт отказ политики, а не ошибку 22P02.
create or replace function private.attachment_project_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

revoke all on function private.attachment_project_id(text) from public, anon;
grant execute on function private.attachment_project_id(text) to authenticated;

-- project_access(null) и project_can_edit(null) дают отказ.
drop policy if exists task_attachments_objects_select on storage.objects;
create policy task_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.project_access(private.attachment_project_id(name)) is not null
  );

drop policy if exists task_attachments_objects_insert on storage.objects;
create policy task_attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );

drop policy if exists task_attachments_objects_delete on storage.objects;
create policy task_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.project_can_edit(private.attachment_project_id(name))
  );
```

- [ ] **Step 4: Применить миграцию локально**

Run: `supabase migration up --local`
Expected: `Applying migration 0017_task_attachments.sql...` без ошибок. **Не** использовать `supabase db reset`.

- [ ] **Step 5: Запустить pgTAP — проходит**

Run: `supabase test db`
Expected: `attachments.test.sql .. ok` (28/28) и `rls.test.sql .. ok` (142/142, включая «anon cannot execute any function in the public schema»).

Если тест №12 падает с `22P02` — политика вызвала приведение вне CASE; проверить, что в политиках используется только `private.attachment_project_id(name)`.

- [ ] **Step 6: Перегенерировать типы**

Run: `supabase gen types typescript --local > lib/types/database.ts`
Expected: в файле появилась `task_attachments` (`grep -n "task_attachments" lib/types/database.ts`). `git diff --stat lib/types/database.ts` показывает только добавления по этой таблице.

- [ ] **Step 7: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 8: Отчёт и коммит после подтверждения**

```bash
git add supabase/migrations/0017_task_attachments.sql supabase/tests/database/attachments.test.sql lib/types/database.ts
git commit -m "feat: таблица и bucket для фото к задачам с RLS (0017)"
```

---

### Task 3: Server actions загрузки и удаления

**Files:**
- Create: `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts`
- Create: `app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts`

**Interfaces:**
- Consumes (Task 1): `ATTACHMENTS_BUCKET`, `MAX_ATTACHMENTS_PER_TASK`, `buildAttachmentPath`, `isValidAttachmentPath`, `isValidDimension`, `ATTACHMENT_MESSAGES`, `isUniqueViolation`.
- Consumes (Task 2): таблица `task_attachments`, bucket `task-attachments`.
- Consumes (существующее): `requireProjectEdit(projectId): Promise<ActionResult | null>`, `NO_EDIT_ACCESS_MESSAGE` из `lib/projects/access.ts`; `createClient()` из `lib/supabase/server.ts`; `ActionResult` из `lib/types/action-result.ts`.
- Produces:
  - `type StartUploadResult = { ok: true; path: string; signedUrl: string } | { ok: false; error: string }`;
  - `startTaskAttachmentUploadAction(projectId: string, taskId: string): Promise<StartUploadResult>`;
  - `confirmTaskAttachmentAction(projectId: string, taskId: string, path: string, width: number, height: number): Promise<ActionResult>`;
  - `deleteTaskAttachmentAction(projectId: string, taskId: string, attachmentId: string): Promise<ActionResult>`.

Тесты используют фейковый клиент Supabase: каждый вызов `from(table)` берёт следующий результат из очереди этой таблицы. Это первый в проекте тест server actions с `vi.mock`.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ATTACHMENT_MESSAGES } from "@/lib/errors";

const state = vi.hoisted(() => ({ client: null as unknown, denied: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/projects/access", () => ({
  NO_EDIT_ACCESS_MESSAGE: "Недостаточно прав для изменения данных проекта.",
  requireProjectEdit: vi.fn(async () => state.denied),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => state.client) }));

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import {
  confirmTaskAttachmentAction,
  deleteTaskAttachmentAction,
  startTaskAttachmentUploadAction,
} from "./attachment-actions";

const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TASK = "e0000000-0000-0000-0000-00000000000a";
const FILE = "f0000000-0000-4000-8000-000000000001";
const PATH = `${PROJECT}/${TASK}/${FILE}.jpg`;

type Builder = {
  select: Mock;
  eq: Mock;
  insert: Mock;
  delete: Mock;
  maybeSingle: Mock;
  then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
};

function builder(result: unknown): Builder {
  const b = {} as Builder;
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

function fakeClient(results: Record<string, unknown[]>) {
  const builders: Record<string, Builder[]> = {};
  const storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: "t", path },
      error: null,
    })),
    list: vi.fn(async () => ({ data: [{ name: `${FILE}.jpg`, metadata: { size: 345678 } }], error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const client = {
    from: vi.fn((table: string) => {
      const b = builder(results[table]?.shift());
      (builders[table] ??= []).push(b);
      return b;
    }),
    storage: { from: vi.fn(() => storage) },
  };
  return { client, builders, storage };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = null;
});

describe("startTaskAttachmentUploadAction", () => {
  it("returns the access error without touching Supabase", async () => {
    state.denied = { ok: false, error: "Недостаточно прав для изменения данных проекта." };
    const result = await startTaskAttachmentUploadAction(PROJECT, TASK);
    expect(result).toEqual({ ok: false, error: "Недостаточно прав для изменения данных проекта." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown task", async () => {
    const { client } = fakeClient({ tasks: [{ data: null, error: null }] });
    state.client = client;
    expect(await startTaskAttachmentUploadAction(PROJECT, TASK)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.taskNotFound,
    });
  });

  it("stops at the per-task limit before issuing an upload URL", async () => {
    const { client, storage } = fakeClient({
      tasks: [{ data: { id: TASK }, error: null }],
      task_attachments: [{ count: 30, error: null }],
    });
    state.client = client;
    expect(await startTaskAttachmentUploadAction(PROJECT, TASK)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.limitReached,
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("issues a signed upload URL for a server-chosen path", async () => {
    const { client, storage } = fakeClient({
      tasks: [{ data: { id: TASK }, error: null }],
      task_attachments: [{ count: 2, error: null }],
    });
    state.client = client;
    const result = await startTaskAttachmentUploadAction(PROJECT, TASK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(new RegExp(`^${PROJECT}/${TASK}/[0-9a-f-]{36}\\.jpg$`));
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path);
    expect(result.signedUrl).toContain(result.path);
  });
});

describe("confirmTaskAttachmentAction", () => {
  it("rejects a path of another task without asking Storage", async () => {
    const { client, storage } = fakeClient({});
    state.client = client;
    const foreign = `${PROJECT}/e0000000-0000-0000-0000-00000000000b/${FILE}.jpg`;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, foreign, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(storage.list).not.toHaveBeenCalled();
  });

  it("rejects non-integer or oversize dimensions", async () => {
    const { client } = fakeClient({});
    state.client = client;
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 10.5, 100)).ok).toBe(false);
    expect((await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 100, 2001)).ok).toBe(false);
  });

  it("does not insert a row when the object is missing in Storage", async () => {
    const { client, storage } = fakeClient({});
    storage.list.mockResolvedValueOnce({ data: [], error: null });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("inserts the row with the size reported by Storage", async () => {
    const { client, builders, storage } = fakeClient({ task_attachments: [{ error: null }] });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(storage.list).toHaveBeenCalledWith(`${PROJECT}/${TASK}`, { search: `${FILE}.jpg`, limit: 1 });
    expect(builders.task_attachments[0].insert).toHaveBeenCalledWith({
      project_id: PROJECT,
      task_id: TASK,
      storage_path: PATH,
      size_bytes: 345678,
      width: 2000,
      height: 1500,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/${PROJECT}/tasks/${TASK}`);
  });

  it("treats a repeated confirm of the same path as success and keeps the file", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23505", message: "duplicate key" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({ ok: true });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes the uploaded file when the row cannot be inserted", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ error: { code: "23503", message: "fk violation" } }],
    });
    state.client = client;
    expect(await confirmTaskAttachmentAction(PROJECT, TASK, PATH, 2000, 1500)).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.uploadFailed,
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });
});

describe("deleteTaskAttachmentAction", () => {
  it("reports a missing photo and does not touch Storage", async () => {
    const { client, storage } = fakeClient({ task_attachments: [{ data: [], error: null }] });
    state.client = client;
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({
      ok: false,
      error: ATTACHMENT_MESSAGES.notFound,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes the file by the path stored in the deleted row", async () => {
    const { client, builders, storage } = fakeClient({
      task_attachments: [{ data: [{ storage_path: PATH }], error: null }],
    });
    state.client = client;
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({ ok: true });
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("id", "id-1");
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("task_id", TASK);
    expect(builders.task_attachments[0].eq).toHaveBeenCalledWith("project_id", PROJECT);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("still succeeds when the file removal fails (orphan is only logged)", async () => {
    const { client, storage } = fakeClient({
      task_attachments: [{ data: [{ storage_path: PATH }], error: null }],
    });
    storage.remove.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    state.client = client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteTaskAttachmentAction(PROJECT, TASK, "id-1")).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts"`
Expected: FAIL — `Failed to resolve import "./attachment-actions"`.

- [ ] **Step 3: Реализовать `attachment-actions.ts`**

```ts
"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENTS_PER_TASK,
  buildAttachmentPath,
  isValidAttachmentPath,
  isValidDimension,
} from "@/lib/business/attachments";
import { ATTACHMENT_MESSAGES, isUniqueViolation } from "@/lib/errors";
import { NO_EDIT_ACCESS_MESSAGE, requireProjectEdit } from "@/lib/projects/access";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";

// Загрузка фото в три шага (docs/superpowers/specs/2026-10-07-task-attachments-design.md §4):
// сервер выдаёт ссылку на свой путь → браузер кладёт байты прямо в Storage →
// сервер проверяет объект и записывает строку. Права проверяют RLS таблицы
// и RLS storage.objects; service role не используется.

export type StartUploadResult =
  | { ok: true; path: string; signedUrl: string }
  | { ok: false; error: string };

export async function startTaskAttachmentUploadAction(
  projectId: string,
  taskId: string,
): Promise<StartUploadResult> {
  if (await requireProjectEdit(projectId)) {
    return { ok: false, error: NO_EDIT_ACCESS_MESSAGE };
  }

  const supabase = await createClient();
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (taskError) {
    console.error("startTaskAttachmentUploadAction (task):", taskError);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }
  if (!task) {
    return { ok: false, error: ATTACHMENT_MESSAGES.taskNotFound };
  }

  // Лимит мягкий: две одновременные загрузки могут дать на одно фото больше.
  const { count, error: countError } = await supabase
    .from("task_attachments")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("project_id", projectId);

  if (countError) {
    console.error("startTaskAttachmentUploadAction (count):", countError);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_TASK) {
    return { ok: false, error: ATTACHMENT_MESSAGES.limitReached };
  }

  const path = buildAttachmentPath(projectId, taskId, randomUUID());
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("startTaskAttachmentUploadAction (sign):", error);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  return { ok: true, path, signedUrl: data.signedUrl };
}

export async function confirmTaskAttachmentAction(
  projectId: string,
  taskId: string,
  path: string,
  width: number,
  height: number,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  if (!isValidAttachmentPath(path, projectId, taskId) || !isValidDimension(width) || !isValidDimension(height)) {
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  const supabase = await createClient();
  const bucket = supabase.storage.from(ATTACHMENTS_BUCKET);
  const folder = `${projectId}/${taskId}`;
  const fileName = path.slice(folder.length + 1);

  // Размер берётся из метаданных Storage, а не от клиента.
  const { data: objects, error: listError } = await bucket.list(folder, { search: fileName, limit: 1 });
  const object = objects?.find((o) => o.name === fileName);
  const size = Number(object?.metadata?.size);

  if (listError || !object || !(size > 0)) {
    console.error("confirmTaskAttachmentAction (object not found):", listError ?? path);
    return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
  }

  const { error } = await supabase.from("task_attachments").insert({
    project_id: projectId,
    task_id: taskId,
    storage_path: path,
    size_bytes: size,
    width,
    height,
  });

  if (error) {
    // Повторное подтверждение того же пути (двойной клик, повтор после
    // таймаута): строка уже есть — это успех, файл удалять нельзя.
    if (!isUniqueViolation(error)) {
      console.error("confirmTaskAttachmentAction (insert):", error);
      const { error: removeError } = await bucket.remove([path]);
      if (removeError) console.error("confirmTaskAttachmentAction (cleanup):", removeError);
      return { ok: false, error: ATTACHMENT_MESSAGES.uploadFailed };
    }
  }

  revalidatePath(`/${projectId}/tasks/${taskId}`);
  return { ok: true };
}

export async function deleteTaskAttachmentAction(
  projectId: string,
  taskId: string,
  attachmentId: string,
): Promise<ActionResult> {
  const denied = await requireProjectEdit(projectId);
  if (denied) return denied;

  const supabase = await createClient();
  // Путь к файлу — из удалённой строки, клиенту не доверяем. Сначала строка:
  // при сбое Storage остаётся невидимая «сирота», а не битая миниатюра.
  const { data, error } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", attachmentId)
    .eq("task_id", taskId)
    .eq("project_id", projectId)
    .select("storage_path");

  if (error) {
    console.error("deleteTaskAttachmentAction:", error);
    return { ok: false, error: ATTACHMENT_MESSAGES.deleteFailed };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: ATTACHMENT_MESSAGES.notFound };
  }

  const { error: removeError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([data[0].storage_path]);
  if (removeError) {
    console.error("deleteTaskAttachmentAction (storage, orphan left):", removeError);
  }

  revalidatePath(`/${projectId}/tasks/${taskId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Запустить тесты — проходят**

Run: `npx vitest run "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts"`
Expected: PASS (13 тестов).

- [ ] **Step 5: Полный прогон и типы**

Run: `npx tsc --noEmit && npx eslint "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts" "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts" && npm test`
Expected: без ошибок; все vitest-тесты зелёные (77 прежних + новые).

- [ ] **Step 6: Отчёт и коммит после подтверждения**

```bash
git add "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.ts" "app/(app)/[projectId]/tasks/[taskId]/attachment-actions.test.ts"
git commit -m "feat: server actions загрузки и удаления фото задачи"
```

---

### Task 4: Сжатие в браузере, блок «Фото» в карточке задачи

**Files:**
- Create: `lib/attachments/compress-image.ts`
- Create: `app/(app)/[projectId]/tasks/[taskId]/task-attachments.tsx`
- Modify: `app/(app)/[projectId]/tasks/[taskId]/page.tsx` (импорты: строки 1–16; `Promise.all`: строки 26–63; после `canEdit`: строка 71; JSX после `<TaskMaterials … />`: строки 136–142)

**Interfaces:**
- Consumes (Task 1): `fitWithin`, `MAX_SIDE`, `JPEG_QUALITY`, `MAX_SOURCE_BYTES`, `ATTACHMENTS_BUCKET`, `SIGNED_URL_TTL_SECONDS`, `ATTACHMENT_MESSAGES`, `formatUploadErrors`.
- Consumes (Task 3): `startTaskAttachmentUploadAction`, `confirmTaskAttachmentAction`, `deleteTaskAttachmentAction`.
- Produces:
  - `compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }>`, бросает `UnsupportedImageError`;
  - `type TaskPhoto = { id: string; url: string | null; width: number; height: number }`;
  - компонент `TaskAttachments({ projectId, taskId, photos, canEdit })`.

Canvas и `createImageBitmap` в vitest (окружение `node`) недоступны. Расчёт размеров уже покрыт тестами `fitWithin` (Task 1), поэтому этот код проверяется в браузере (шаг 6).

- [ ] **Step 1: Прочитать документацию Next 16**

Прочитать в `node_modules/next/dist/docs/` разделы про Server Actions, вызываемые из Client Components, и про `useRouter().refresh()`. Убедиться, что вызов action как обычной async-функции из обработчика события — поддерживаемый способ (так уже сделано в `task-materials.tsx`).

- [ ] **Step 2: Создать `lib/attachments/compress-image.ts`**

```ts
import { fitWithin, JPEG_QUALITY, MAX_SIDE } from "@/lib/business/attachments";

// Только браузер: уменьшение фото до MAX_SIDE по длинной стороне и JPEG.
// Перекодирование отбрасывает EXIF, включая GPS. Поворот из EXIF
// применяется при декодировании.

export class UnsupportedImageError extends Error {}

export type CompressedImage = { blob: Blob; width: number; height: number };

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Например, HEIC в браузере без поддержки — пробуем через <img>.
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new UnsupportedImageError();
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const decoded = await decode(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new UnsupportedImageError();
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    // iOS Safari держит память canvas до сборки мусора — освобождаем сразу.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new UnsupportedImageError();
    return { blob, width, height };
  } finally {
    decoded.release();
  }
}
```

- [ ] **Step 3: Создать `task-attachments.tsx`**

```tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeftIcon, ChevronRightIcon, ImagePlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { compressImage } from "@/lib/attachments/compress-image";
import { MAX_SOURCE_BYTES } from "@/lib/business/attachments";
import { ATTACHMENT_MESSAGES, formatUploadErrors } from "@/lib/errors";

import {
  confirmTaskAttachmentAction,
  deleteTaskAttachmentAction,
  startTaskAttachmentUploadAction,
} from "./attachment-actions";

export type TaskPhoto = { id: string; url: string | null; width: number; height: number };

export function TaskAttachments({
  projectId,
  taskId,
  photos,
  canEdit,
}: {
  projectId: string;
  taskId: string;
  /** url = null — подписать ссылку не удалось; показывается заглушка. */
  photos: TaskPhoto[];
  /** false — только просмотр: без добавления и удаления. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const current = openIndex === null ? null : (photos[openIndex] ?? null);

  // Ошибка одного фото — текст для пользователя; null — загружено.
  async function uploadOne(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) return ATTACHMENT_MESSAGES.unsupported;
    if (file.size > MAX_SOURCE_BYTES) return ATTACHMENT_MESSAGES.tooLarge;

    let compressed;
    try {
      compressed = await compressImage(file);
    } catch {
      return ATTACHMENT_MESSAGES.unsupported;
    }

    try {
      const start = await startTaskAttachmentUploadAction(projectId, taskId);
      if (!start.ok) return start.error;

      const response = await fetch(start.signedUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg", "x-upsert": "false" },
        body: compressed.blob,
      });
      if (!response.ok) return ATTACHMENT_MESSAGES.uploadFailed;

      const confirmed = await confirmTaskAttachmentAction(
        projectId,
        taskId,
        start.path,
        compressed.width,
        compressed.height,
      );
      return confirmed.ok ? null : confirmed.error;
    } catch {
      return ATTACHMENT_MESSAGES.uploadFailed;
    }
  }

  // По одному: меньше пиковая память на телефоне и понятный прогресс.
  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const errors: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ current: index + 1, total: files.length });
      const error = await uploadOne(file);
      if (error) errors.push(error);
    }
    setProgress(null);
    router.refresh();

    const message = formatUploadErrors(errors, files.length);
    if (message) toast.error(message);
  }

  function showNext(step: 1 | -1) {
    setOpenIndex((index) => (index === null ? null : (index + step + photos.length) % photos.length));
  }

  function handleDelete() {
    if (!current || !window.confirm("Удалить фото?")) return;
    startDelete(async () => {
      const result = await deleteTaskAttachmentAction(projectId, taskId, current.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpenIndex(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Фото</Label>

      {photos.length === 0 ? (
        <EmptyState>Фото пока нет.</EmptyState>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <PhotoThumb
              key={photo.url ?? photo.id}
              photo={photo}
              index={index}
              onOpen={() => setOpenIndex(index)}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <div>
          {/* Без capture: на телефоне система предлагает и камеру, и галерею. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={progress !== null}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlusIcon />
            {progress ? `Загружается ${progress.current} из ${progress.total}` : "Добавить фото"}
          </Button>
        </div>
      ) : null}

      <Dialog.Root
        open={current !== null}
        onOpenChange={(open) => {
          if (!open) setOpenIndex(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/90" />
          <Dialog.Popup
            className="fixed inset-0 z-50 flex flex-col outline-none"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") showNext(1);
              if (event.key === "ArrowLeft") showNext(-1);
            }}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <Dialog.Title className="text-[13px] font-semibold text-white">
                Фото {(openIndex ?? 0) + 1} из {photos.length}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <Button type="button" variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                    <Trash2Icon />
                    Удалить
                  </Button>
                ) : null}
                <Dialog.Close aria-label="Закрыть" className={buttonVariants({ variant: "secondary", size: "icon" })}>
                  <XIcon />
                </Dialog.Close>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
              {current ? <ViewerImage key={current.url ?? current.id} photo={current} /> : null}
              {photos.length > 1 ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Предыдущее фото"
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    onClick={() => showNext(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Следующее фото"
                    className="absolute top-1/2 right-3 -translate-y-1/2"
                    onClick={() => showNext(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              ) : null}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

const EXPIRED_TEXT = "Обновите страницу";

function PhotoThumb({ photo, index, onOpen }: { photo: TaskPhoto; index: number; onOpen: () => void }) {
  // Подписанная ссылка живёт час: на долго открытой вкладке картинка
  // перестаёт грузиться — показываем подсказку вместо битого изображения.
  const [broken, setBroken] = useState(false);

  if (!photo.url || broken) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md bg-page p-1 text-center text-[11px] text-faint">
        {EXPIRED_TEXT}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Открыть фото ${index + 1}`}
      className="aspect-square overflow-hidden rounded-md bg-page outline-none focus-visible:ring-[3px] focus-visible:ring-brand/12"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка живёт час, оптимизатор next/image её не кеширует */}
      <img
        src={photo.url}
        alt=""
        loading="lazy"
        width={photo.width}
        height={photo.height}
        className="size-full object-cover"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

function ViewerImage({ photo }: { photo: TaskPhoto }) {
  const [broken, setBroken] = useState(false);

  if (!photo.url || broken) {
    return <p className="text-[13px] text-white/70">{EXPIRED_TEXT}</p>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка живёт час, оптимизатор next/image её не кеширует
    <img
      src={photo.url}
      alt=""
      width={photo.width}
      height={photo.height}
      className="max-h-full max-w-full object-contain"
      onError={() => setBroken(true)}
    />
  );
}
```

Сетка — `grid-cols-3 sm:grid-cols-4`, а не 5–6 из спеки: карточка задачи ограничена `max-w-lg` (512 px), и 5–6 колонок дали бы миниатюры около 80 px.

- [ ] **Step 4: Подключить блок в `page.tsx`**

В импорты (после строки 9, `import { createClient } …`) добавить:

```ts
import { ATTACHMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/business/attachments";
```

После строки 16 (`import { TaskMaterials } from "./task-materials";`) добавить:

```ts
import { TaskAttachments, type TaskPhoto } from "./task-attachments";
```

В деструктуризацию `Promise.all` после `{ data: taskMaterials },` добавить `{ data: attachments },`, а в массив запросов после запроса `task_materials` — элемент:

```ts
    supabase
      .from("task_attachments")
      .select("id, storage_path, width, height")
      .eq("task_id", taskId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
```

После строки `const canEdit = canEditProject(role);` добавить:

```ts
  // Ссылки на просмотр подписываются одним запросом; RLS storage.objects
  // пропускает только участников проекта.
  let photos: TaskPhoto[] = [];
  if (attachments && attachments.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(
        attachments.map((a) => a.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signError) console.error("TaskPage (sign attachments):", signError);
    const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    photos = attachments.map((a) => ({
      id: a.id,
      url: urlByPath.get(a.storage_path) ?? null,
      width: a.width,
      height: a.height,
    }));
  }
```

В JSX сразу после закрывающего `/>` компонента `<TaskMaterials … />` добавить:

```tsx
          <TaskAttachments projectId={projectId} taskId={taskId} photos={photos} canEdit={canEdit} />
```

- [ ] **Step 5: Типы, линтер, тесты, сборка**

Run: `npx tsc --noEmit && npx eslint . && npm test && npm run build`
Expected: всё без ошибок.

- [ ] **Step 6: Проверка в браузере на локальном стеке**

Запустить dev-сервер через `preview_start` с конфигурацией `dev` (`.claude/launch.json`). Войти под тестовым владельцем проекта: учётные данные — в scratchpad сессии; в чат их не выводить. Открыть карточку задачи и проверить по списку:

1. **Пустое состояние.** Видны «Фото пока нет.» и кнопка «Добавить фото».
2. **Загрузка пачки.** Выбрать 3 JPEG, среди них хотя бы один больше 2000 px. Во время загрузки видно «Загружается N из 3». После загрузки 3 миниатюры. В Supabase Studio (`http://127.0.0.1:54323` → Storage → `task-attachments`) лежат 3 объекта по пути `{project}/{task}/{uuid}.jpg`, у самого крупного длинная сторона 2000 px (проверить, открыв объект), размер ~300–700 КБ.
3. **Не-изображение в пачке.** Выбрать JPEG и `.txt` (или `.heic` в Chrome). JPEG загружается, toast: «Не удалось загрузить 1 фото из 2. Этот формат фото не поддерживается. Сохраните его как JPEG.»
4. **Просмотр.** По клику открывается полноэкранный просмотр, листается стрелками и клавишами ←/→, закрывается по Esc. В консоли нет ошибок (`read_console_messages`, `onlyErrors: true`).
5. **Удаление.** «Удалить» → подтверждение. Фото исчезло из сетки, объект исчез из Storage.
6. **Истёкшая ссылка.** Через `javascript_tool` заменить `src` первой миниатюры на `src + "x"`; появляется «Обновите страницу».
7. **Viewer.** Войти под тестовым viewer этого проекта: фото видны, кнопок «Добавить фото» и «Удалить» нет.
8. **Чужой пользователь.** Под пользователем без доступа к проекту URL задачи даёт 404, подписанную ссылку получить нельзя.
9. **Если `PUT` возвращает 4xx** (Network: `read_network_requests`, фильтр `object/upload/sign`): прочитать тело ответа и проверить, не нужен ли Storage `FormData` вместо сырого тела. Исправлять через systematic-debugging, а не наугад.

Скриншоты — с `scale: 0.5`.

- [ ] **Step 7: Отчёт и коммит после подтверждения**

```bash
git add lib/attachments/compress-image.ts "app/(app)/[projectId]/tasks/[taskId]/task-attachments.tsx" "app/(app)/[projectId]/tasks/[taskId]/page.tsx"
git commit -m "feat: блок «Фото» в карточке задачи — загрузка, просмотр, удаление"
```

---

### Task 5: Документация и финальная проверка

**Files:**
- Modify: `docs/database.md` (новый §5.14 перед «## 6. RLS» — строка 357; список миграций — после строки 516; итог тестов — строка 520)
- Modify: `docs/architecture.md` (новый §3.1 в конце §3, перед «## 4.» — строка 54; структура проекта в §11)
- Modify: `docs/roadmap.md` (строка 81 и новые пункты в «После MVP»)

**Interfaces:**
- Consumes: всё из Tasks 1–4.
- Produces: документацию, отражающую фактическое состояние.

- [ ] **Step 1: `docs/database.md` — раздел таблицы**

Перед строкой `## 6. RLS` вставить:

```markdown
### 5.14 `task_attachments` — фото к задачам (0017)

Фото хранятся в приватном bucket Storage `task-attachments` (10 МБ на файл, только `image/jpeg`) по пути `{project_id}/{task_id}/{uuid}.jpg`; путь выбирает сервер. В таблице — по строке на фото: `storage_path` (unique), `size_bytes` (из метаданных Storage), `width`, `height`, `created_by`, `created_at`. Порядок в ленте — `created_at`.

* Составной FK `(task_id, project_id) → tasks` (`on delete cascade`) и CHECK `task_attachments_path_matches_task`: путь принадлежит именно этой задаче и имеет вид `{uuid}.jpg`.
* RLS таблицы: SELECT — любой участник; INSERT/DELETE — `project_can_edit`; UPDATE — никто.
* RLS `storage.objects` для bucket: проект — первая папка пути через `private.attachment_project_id(name)` (null для не-uuid, поэтому некорректный путь даёт отказ, а не ошибку). SELECT — участник, INSERT/DELETE — `project_can_edit`, UPDATE — никто.
* Удаление строки задачи каскадом удаляет строки фото, но не файлы — удаления задач в приложении нет; см. roadmap.
```

- [ ] **Step 2: `docs/database.md` — список миграций и итог тестов**

После пункта `16. 0016_revoke_function_execute …` добавить:

```markdown
17. `0017_task_attachments` — таблица `task_attachments`, приватный bucket `task-attachments`, RLS на таблице и `storage.objects`, helper `private.attachment_project_id`.
```

Строку с итогом тестов заменить на:

```markdown
Миграции применены на локальном стеке и покрыты pgTAP-тестами RLS и RPC в `supabase/tests/database/rls.test.sql` (142) и `supabase/tests/database/attachments.test.sql` (28) — `supabase test db`, 170/170 успешно. TypeScript-типы сгенерированы в `lib/types/database.ts`.
```

- [ ] **Step 3: `docs/architecture.md` — схема загрузки**

Перед `## 4. Маршрутизация и выбор проекта` вставить:

```markdown
### 3.1 Фото задач: загрузка в Storage

Байты фото не проходят через сервер Next.js:

1. Браузер сжимает фото (`lib/attachments/compress-image.ts`: ≤ 2000 px, JPEG 0.85, без EXIF).
2. `startTaskAttachmentUploadAction` проверяет права, задачу и лимит (30 фото), выбирает путь и выдаёт signed upload URL.
3. Браузер отправляет JPEG `PUT`-запросом прямо в Storage.
4. `confirmTaskAttachmentAction` проверяет путь и наличие объекта, берёт размер из Storage и вставляет строку `task_attachments`.

Просмотр — ссылки, подписанные на сервере на час (`createSignedUrls`). Удаление: сначала строка, затем файл (ошибка удаления файла только логируется). Server actions — `tasks/[taskId]/attachment-actions.ts`, UI — `tasks/[taskId]/task-attachments.tsx`.
```

В §11 «Структура проекта» добавить строки для `lib/attachments/compress-image.ts`, `tasks/[taskId]/attachment-actions.ts` и `tasks/[taskId]/task-attachments.tsx` в формате соседних строк.

- [ ] **Step 4: `docs/roadmap.md`**

Строку `7. Вложения к задачам (Supabase Storage).` заменить на `7. ~~Вложения к задачам (Supabase Storage)~~ — сделано (фото к задачам, 0017).` и добавить в конец списка «После MVP» (после пункта 9):

```markdown
10. Очистка файлов-«сирот» в bucket `task-attachments`: объекты без строки `task_attachments` старше суток (оборванные загрузки, сбой удаления файла).
11. При появлении удаления задачи или проекта — удалять их файлы из Storage в том же действии.
12. Значок числа фото на карточке задачи на доске.
```

- [ ] **Step 5: Финальная проверка**

Run: `npx tsc --noEmit && npx eslint . && npm test && npm run build && supabase test db`
Expected: всё зелёное, pgTAP 170/170.

- [ ] **Step 6: Отчёт и коммит после подтверждения**

```bash
git add docs/database.md docs/architecture.md docs/roadmap.md
git commit -m "docs: фото к задачам — схема, загрузка, roadmap"
```

---

### Task 6: Production (только по явной команде пользователя)

**Files:** нет изменений в коде.

**Interfaces:**
- Consumes: коммиты Tasks 1–5 в `main`.
- Produces: миграция 0017 на Supabase `nohygbqkegxkfcejjycv`, деплой на Timeweb (автодеплой из `main`).

- [ ] **Step 1: Спросить пользователя и дождаться «да»** на применение 0017 к production и `git push`.

- [ ] **Step 2: Пробный прогон**

Run: `supabase db push --dry-run`
Expected: в списке только `0017_task_attachments.sql`.

- [ ] **Step 3: Применить и проверить советника**

Run: `supabase db push`
Затем — security advisor проекта (MCP `get_advisors`, тип `security`). Expected: нет новых предупреждений по `task_attachments`, `attachment_project_id`, `storage.objects`.

- [ ] **Step 4: Push и деплой**

Run: `git push`
Expected: автодеплой Timeweb (приложение 266427) завершился, `https://harnblaze-repair-planner-eff7.twc1.net` открывается.

- [ ] **Step 5: Чек-лист для пользователя (на телефоне)**

Передать пользователю:
1. Открыть заявку на iPhone → «Добавить фото» → «Снять фото» → снимок появился.
2. Выбрать 3 фото из галереи → все загрузились.
3. Если есть: фото 48 Мп (iPhone Pro, режим ProRAW/48MP выключен — обычный HEIF) → загрузилось без ошибки.
4. То же на Android.
5. Открыть просмотр, пролистать, удалить одно фото.

Если пункт 3 падает — systematic-debugging; ожидаемое направление — промежуточное уменьшение в два шага в `compress-image.ts` (спека §12).
```
