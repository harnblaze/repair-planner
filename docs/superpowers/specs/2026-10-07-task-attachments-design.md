# Фото к задачам — дизайн

_Дата: 2026-10-07 · Статус: на ревью_

## 1. Цель и рамки

Мастер фотографирует объект работ на телефон и прикладывает фото к заявке, чтобы было видно, что и где делалось.

**Решения пользователя:**

- только фото (без PDF, чертежей, произвольных файлов);
- сжатие в браузере до ≤ 2000 px по длинной стороне, JPEG ~85%; оригиналы не храним;
- одна плоская лента фото на задачу в порядке загрузки — без групп «до/после» и подписей.

**Не входит:** видео и документы, подписи, сортировка, значок фото на карточке доски, автоочистка «сирот», офлайн-загрузка. Кандидаты записываются в `docs/roadmap.md` (§7).

**Ограничения:** Supabase free tier (1 ГБ Storage), контейнер Timeweb 1 ГБ RAM, без service role key (CLAUDE.md §11), RLS на всё (CLAUDE.md §7).

## 2. Выбранный подход: signed upload URL

1. Server action проверяет права и выдаёт signed upload URL на путь, выбранный сервером.
2. Браузер отправляет байты напрямую в Storage (`fetch PUT`).
3. Второй server action проверяет, что объект существует, и вставляет строку в БД.

**Отклонённые варианты:**

- Загрузка через Server Action с `FormData`:
  - удваивает трафик;
  - держит файл в памяти контейнера;
  - требует поднять `serverActions.bodySizeLimit` для всего приложения.
- Прямая загрузка через supabase-js в браузере:
  - браузерный клиент Supabase в приложении не используется;
  - путь и строку пришлось бы задавать клиенту, а это больше поверхность прав.

## 3. Данные и безопасность — миграция `0017`

### 3.1 Таблица `public.task_attachments`

| Колонка | Тип | Примечание |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `project_id` | `uuid not null` | |
| `task_id` | `uuid not null` | |
| `storage_path` | `text not null unique` | `{project_id}/{task_id}/{uuid}.jpg` |
| `size_bytes` | `integer not null` | `check (size_bytes > 0)`; берётся из метаданных Storage |
| `width` | `integer not null` | `check (width > 0)` |
| `height` | `integer not null` | `check (height > 0)` |
| `created_by` | `uuid` | `default auth.uid()`, FK на `auth.users on delete set null` |
| `created_at` | `timestamptz not null` | `default now()` |

- Составной FK `(task_id, project_id) → tasks(id, project_id) on delete cascade` — защита от IDOR, как у `task_materials` (`0005_materials_flow.sql`).
- `check (storage_path like project_id::text || '/' || task_id::text || '/%')` — путь не может указывать на чужую задачу.
- Индекс `(task_id, created_at)` для ленты задачи.
- Колонки `position` нет: порядок определяется `created_at`.

### 3.2 RLS таблицы

| Операция | Кто | Условие |
|---|---|---|
| SELECT | участник проекта | `project_access(project_id) is not null` |
| INSERT | owner, member | `project_can_edit(project_id)` |
| DELETE | owner, member | `project_can_edit(project_id)` |
| UPDATE | никто | политики нет |

Шаблон политик — `0012_project_invitations.sql:36-60`, все политики `to authenticated`.

### 3.3 Bucket `task-attachments`

Приватный (`public = false`), `file_size_limit = 10 MB`, `allowed_mime_types = {image/jpeg}`. Создаётся миграцией через `insert into storage.buckets ... on conflict do nothing`.

### 3.4 RLS на `storage.objects` для этого bucket

Проект определяется первой папкой пути: `(storage.foldername(name))[1]`. Приведение к `uuid` выполняется только после проверки формата, иначе некорректный путь вызвал бы ошибку вместо отказа.

| Операция | Условие |
|---|---|
| SELECT | `bucket_id = 'task-attachments'` и `project_access(<project_id из пути>) is not null`. Нужно для `createSignedUrl(s)`. |
| INSERT | `bucket_id = 'task-attachments'` и `project_can_edit(<project_id из пути>)`. Проверяется при `createSignedUploadUrl`. |
| DELETE | то же, что INSERT |
| UPDATE | политики нет — перезапись запрещена, загрузка без `upsert` |

Связь «файл ↔ задача» гарантирует таблица (CHECK и FK из §3.1). Storage-политики — второй слой, на уровне проекта.

### 3.5 Просмотр

Только через подписанные сервером ссылки `createSignedUrls(paths, 3600)` со сроком 1 час. Публичных URL нет.

### 3.6 Функции

Миграция не создаёт функций в `public`. Если при реализации понадобится функция, обязательны `revoke all ... from public, anon` и явный `grant` (см. `0016`).

## 4. Загрузка

Несколько выбранных фото обрабатываются **последовательно**: меньше пиковая память на телефоне и понятный прогресс. Для каждого фото:

1. **Предпроверка в браузере.** `file.type` начинается с `image/`, исходный размер ≤ 40 МБ.
2. **Сжатие** (`lib/attachments/compress-image.ts`):
   - декодирование с учётом поворота из EXIF (`createImageBitmap(file, { imageOrientation: "from-image" })`, при неподдержке — fallback через `<img>`);
   - уменьшение до ≤ 2000 px по длинной стороне;
   - `canvas.toBlob("image/jpeg", 0.85)`.

   Перекодирование удаляет EXIF, включая GPS.
3. **`startTaskAttachmentUpload(projectId, taskId)`.** Проверки:
   - `requireProjectEdit`;
   - задача существует в проекте;
   - у задачи меньше 30 фото. Лимит мягкий: при одновременной загрузке допустимо 31.

   Сервер строит путь `buildAttachmentPath(projectId, taskId, randomUUID())` и вызывает `createSignedUploadUrl(path)`. Возвращает `{ path, signedUrl }`.
4. **Отправка.** `fetch(signedUrl, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } })`. Bucket сам проверяет лимит 10 МБ и MIME.
5. **`confirmTaskAttachment(projectId, taskId, path, width, height)`.**
   - `isValidAttachmentPath(path, projectId, taskId)` — точный шаблон, без `..`;
   - `width` и `height` — целые числа в диапазоне 1..2000;
   - объект существует в Storage; его размер берётся из метаданных, а не от клиента;
   - insert строки, затем `revalidatePath`.

   Если insert не прошёл (например, задачу удалили), сервер пытается удалить загруженный объект (best-effort).

## 5. Удаление

- **Кто:** удалять могут только те, у кого есть право на редактирование (owner, member). Удаление жёсткое: строка и файл.
- **Действие `deleteTaskAttachment(projectId, taskId, attachmentId)`:**
  - клиент передаёт только `attachmentId`;
  - `delete ... .select("storage_path")` с фильтрами `id`, `task_id`, `project_id`; 0 строк — «Фото не найдено»;
  - затем `storage.remove([storage_path])`. Ошибка удаления файла уходит в `console.error`, пользователь видит успех.
- **Почему такой порядок (строка, потом файл):** при сбое остаётся невидимая «сирота», а не битая миниатюра.

## 6. «Сироты»

**Откуда берутся:**

1. Файл загружен, но confirm не дошёл (обрыв сети, закрытая вкладка).
2. Строка удалена, а файл — нет.

Для MVP это допустимо. Удаления задач и проектов в приложении сейчас нет (есть только статус `cancelled`), поэтому массовых «сирот» не возникает.

**В roadmap:**

- периодическая очистка объектов без строки старше суток;
- удаление файлов в том же действии, если появится удаление задачи или проекта.

## 7. Интерфейс

**Где:** блок «Фото» в карточке задачи `app/(app)/[projectId]/tasks/[taskId]/page.tsx`, сразу после `TaskMaterials`.

**Сервер (`page.tsx`):**

- читает `task_attachments` задачи по `created_at asc`;
- одним вызовом `createSignedUrls` получает ссылки;
- передаёт в `TaskAttachments` массив `{ id, url, width, height }` и `canEdit`.

**Клиент `task-attachments.tsx`:**

- **Сетка миниатюр.** Квадратные плитки `object-cover`: 3 в ряд на телефоне, 5–6 на десктопе. `<img loading="lazy">` — не `next/image`, потому что подписанные ссылки живут час.
- **Пусто.** Текст «Фото пока нет».
- **Добавление** (только при `canEdit`):
  - кнопка «Добавить фото» и скрытый `<input type="file" accept="image/*" multiple>`, без `capture`, чтобы на телефоне был выбор камеры или галереи;
  - во время загрузки кнопка заблокирована и показывает «Загружается N из M»;
  - после загрузки — `router.refresh()`.
- **Просмотр:**
  - нажатие на миниатюру открывает полноэкранный `Dialog` из `@base-ui/react`;
  - фото вписано в экран;
  - листание: кнопки и клавиши ←/→, без свайпа;
  - закрытие: Esc или крестик.
- **Удаление** (только при `canEdit`): кнопка в режиме просмотра и `confirm()`. На миниатюрах крестиков нет, чтобы на телефоне не удалить фото случайно.
- **Истёкшая ссылка.** Через `onError` у `<img>` показываем заглушку «Обновите страницу». Автообновления ссылок нет.
- **Ошибки:** toast (`sonner`).

**Доска не меняется.**

## 8. Ошибки

Новая функция сопоставления ошибок в `lib/errors.ts` по образцу `mapBoardMoveError`. Технические детали попадают в `console.error` на сервере. Тексты для пользователя:

| Ситуация | Сообщение |
|---|---|
| Общая ошибка загрузки | «Не удалось загрузить фото. Попробуйте ещё раз.» |
| Лимит | «У задачи уже 30 фото — удалите лишние.» |
| Нет прав | «Нет прав на изменение задачи.» |
| Формат не декодируется (например, HEIC в браузере без поддержки) | «Этот формат фото не поддерживается. Сохраните его как JPEG.» |
| Исходник > 40 МБ | «Фото слишком большое.» |
| Частичный успех из нескольких | загруженные остаются; «Не удалось загрузить N фото из M.» |
| Ошибка удаления | «Не удалось удалить фото. Попробуйте ещё раз.» |

**HEIC.** iOS Safari для `accept="image/*"` сам отдаёт JPEG; Android снимает в JPEG. Ошибка возможна только на десктопе.

## 9. Разбивка кода

| Файл | Ответственность |
|---|---|
| `supabase/migrations/0017_task_attachments.sql` | таблица, RLS, bucket, политики `storage.objects` |
| `lib/business/attachments.ts` | чистые функции и константы: `fitWithin(w, h, max)`, `buildAttachmentPath`, `isValidAttachmentPath`, `MAX_ATTACHMENTS_PER_TASK = 30`, `MAX_SOURCE_BYTES = 40 MB`, `MAX_SIDE = 2000`, `JPEG_QUALITY = 0.85` |
| `lib/attachments/compress-image.ts` | сжатие в браузере (canvas → Blob) |
| `app/(app)/[projectId]/tasks/[taskId]/actions.ts` | `startTaskAttachmentUpload`, `confirmTaskAttachment`, `deleteTaskAttachment` |
| `app/(app)/[projectId]/tasks/[taskId]/task-attachments.tsx` | UI: сетка, загрузка, просмотр, удаление |
| `app/(app)/[projectId]/tasks/[taskId]/page.tsx` | чтение строк и подписанных ссылок |
| `lib/errors.ts` | сообщения об ошибках вложений |

## 10. Тестирование

**pgTAP** (`supabase/tests/database/rls.test.sql`, `plan` увеличивается):

- пользователь B не видит, не вставляет и не удаляет строки `task_attachments` в чужом проекте;
- то же для `storage.objects` в bucket `task-attachments` (по первой папке пути);
- viewer читает, но не вставляет и не удаляет;
- редактор не может вставить строку с `storage_path` чужой задачи или проекта (CHECK) и с `task_id` из другого проекта (FK);
- UPDATE запрещён для таблицы и для `storage.objects` этого bucket;
- bucket приватный, MIME только `image/jpeg`;
- тест «anon cannot execute any function» остаётся зелёным.

**vitest:**

- `fitWithin` — альбомная, портретная, маленькая (без увеличения) и квадратная ориентация;
- `buildAttachmentPath` / `isValidAttachmentPath` — чужой `project_id` или `task_id`, `..`, лишние сегменты, не `.jpg`;
- сопоставление ошибок.

**Вручную, локально через браузер:**

- загрузка нескольких фото;
- просмотр и листание;
- удаление;
- viewer не видит кнопок;
- чужой пользователь не может получить фото.

**На проде (пользователь, по чек-листу):**

- фото с камеры iPhone и Android;
- большое фото (48 Мп) в iOS Safari — риск лимита canvas.

**Перед «готово»:** `tsc`, `eslint`, `npm test`, `npm run build`, `supabase test db`.

## 11. Документация

- `docs/database.md` — таблица, bucket, политики;
- `docs/architecture.md` — схема загрузки;
- `docs/roadmap.md`:
  - очистка «сирот»;
  - удаление файлов при будущем удалении задачи или проекта;
  - значок фото на доске.

## 12. Риски

- **Лимит canvas в iOS Safari на очень больших фото.** Проверка на реальном устройстве; при проблеме — промежуточное уменьшение в два шага.
- **Квота 1 ГБ.** Примерно 2–3 тыс. фото по 300–500 КБ. Лимит 30 фото на задачу и мониторинг через панель Supabase.
- **Миграция `0017` на проде** применяется только после явного подтверждения пользователя (`supabase db push --dry-run`, затем `push`).
