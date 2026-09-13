# Database

> Статус: согласовано 2026-09-11, миграции 0001–0007 реализованы 2026-09-12. Документ соответствует фактической схеме.

## 1. ER-модель

```
auth.users 1─1 profiles
                  │
                  │ owner_id
                  ▼
              projects 1──* project_members *──1 profiles
                  │
                  ├──* categories
                  ├──* executors
                  ├──* materials ──* material_movements
                  ├──* board_lists ──* board_items
                  └──* tasks
                         ├──* task_schedule        (дни работы)
                         ├──* task_executors  *──1 executors
                         └──* task_materials  *──1 materials
                                   │
                                   └── триггер ──► material_movements + materials.current_balance
```

## 2. Общие соглашения

* Первичные ключи — `uuid` с `gen_random_uuid()`.
* Все таблицы содержат `created_at timestamptz not null default now()`; изменяемые — `updated_at`, поддерживаемый общим триггером.
* Денежных величин нет; количества материалов — `numeric(14,3)`.
* Плановые даты — тип `date`. `timestamptz` используется только для моментов времени (`created_at`, `completed_at`).
* Каждая дочерняя таблица хранит денормализованный `project_id` — это делает RLS одной проверкой без JOIN.
* Согласованность `project_id` гарантируется **составными внешними ключами**, а не кодом приложения (см. §4).
* На каждый внешний ключ создаётся индекс.

## 3. Enum-типы

| Тип | Значения |
|---|---|
| `project_role` | `owner`, `member` |
| `task_status` | `new`, `planned`, `in_progress`, `paused`, `completed`, `cancelled` |
| `movement_kind` | `receipt`, `consumption`, `adjustment` |

Расширение ролей в будущем — `ALTER TYPE project_role ADD VALUE 'viewer'`, без миграции данных.

## 4. Приём против IDOR: составные внешние ключи

Классическая уязвимость: пользователь имеет доступ к проекту A и пытается привязать к своей задаче материал из проекта B. Проверка в приложении ненадёжна, а RLS по `project_id` дочерней строки её не ловит, если `project_id` передан клиентом.

Решение — на уровне схемы:

```sql
alter table tasks     add constraint tasks_id_project_key     unique (id, project_id);
alter table materials add constraint materials_id_project_key unique (id, project_id);
alter table executors add constraint executors_id_project_key unique (id, project_id);

alter table task_materials
  add constraint task_materials_task_fk
    foreign key (task_id, project_id) references tasks (id, project_id) on delete cascade,
  add constraint task_materials_material_fk
    foreign key (material_id, project_id) references materials (id, project_id) on delete restrict;
```

Так PostgreSQL сам отвергает разнопроектные связи. Приём применяется ко всем связям: `task_schedule`, `task_executors`, `task_materials`, `material_movements`, `board_items`, `tasks.category_id`.

## 5. Таблицы

### 5.1 `profiles`

Назначение: профиль пользователя, расширение `auth.users`.

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | FK → `auth.users(id)` on delete cascade |
| `full_name` | text | |
| `created_at`, `updated_at` | timestamptz | |

Создаётся триггером на `auth.users` при регистрации.

**RLS:** SELECT/UPDATE — только собственная строка (`id = auth.uid()`). INSERT — через триггер. DELETE — запрещён.

### 5.2 `projects`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK → `profiles(id)`, on delete restrict |
| `name` | text not null | `length between 1 and 120` |
| `description` | text | |
| `timezone` | text not null default `'Europe/Moscow'` | IANA-идентификатор, валидируется триггером и Zod |
| `archived_at` | timestamptz | soft delete |
| `created_at`, `updated_at` | timestamptz | |

Индексы: `(owner_id)`.

**RLS:** SELECT — владельцу (`owner_id = auth.uid()`) или участнику (`project_access(id) is not null`). INSERT — любому аутентифицированному, с `owner_id = auth.uid()`. UPDATE/DELETE — только владельцу.

Прямая проверка `owner_id` в SELECT (миграция 0007) — не просто оптимизация: без неё `INSERT ... RETURNING` от лица владельца падал с ошибкой RLS. Политика `projects_select` изначально проверяла доступ только через `project_access()`, которая читает `project_members`; эта строка появляется лишь после `AFTER INSERT`-триггера `handle_new_project`, а RLS для `RETURNING` оценивается по снапшоту команды, ещё не видящему эффект триггера. INSERT без `RETURNING` проходил, INSERT с `RETURNING` (обычный способ получить `id` созданной записи) — нет.

Триггер `after insert`: создаёт запись в `project_members` (роль `owner`) и три системных списка `board_lists`.

### 5.3 `project_members`

Назначение: членство и уровень доступа. Единственный источник правды о доступе — владелец тоже присутствует здесь.

| Поле | Тип | Примечание |
|---|---|---|
| `project_id` | uuid | FK → `projects(id)` on delete cascade |
| `user_id` | uuid | FK → `profiles(id)` on delete cascade |
| `role` | project_role not null | |
| `created_at` | timestamptz | |

PK: `(project_id, user_id)`. Индекс: `(user_id)` — для списка проектов пользователя.

**RLS:** SELECT — членам того же проекта. INSERT/UPDATE/DELETE — только владельцу проекта. В MVP UI приглашений нет.

### 5.4 `categories` — цеха-заказчики

| Поле | Тип |
|---|---|
| `id` uuid PK, `project_id` uuid, `name` text, `color` text, `sort_order` int, `is_archived` boolean default false, timestamps |

Ограничения: `unique (project_id, lower(name)) where not is_archived`.
Индексы: `(project_id, sort_order)`.
Удаление: архивация; физическое удаление запрещено при наличии задач (`on delete restrict` в `tasks.category_id`, само поле nullable).

### 5.5 `executors` — справочник исполнителей

| Поле | Тип |
|---|---|
| `id` uuid PK, `project_id` uuid, `name` text not null, `position` text, `is_active` boolean default true, timestamps |

Исполнитель не является пользователем Supabase. Индексы: `(project_id, is_active)`.

### 5.6 `materials`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid | |
| `name` | text not null | |
| `unit` | text not null | «кг», «шт», «л» |
| `current_balance` | numeric(14,3) not null default 0 | **кеш**, поддерживается только триггерами |
| `minimum_balance` | numeric(14,3) not null default 0 | `>= 0` |
| `is_active` | boolean default true | |
| timestamps | | |

Ограничения: `unique (project_id, lower(name))`. Отрицательный `current_balance` **разрешён** — согласованное правило (см. §7.3).
Индексы: `(project_id, is_active)`; частичный индекс для предупреждений о низком остатке: `(project_id) where current_balance <= minimum_balance`.

**RLS:** SELECT/INSERT/UPDATE — членам проекта; UPDATE колонки `current_balance` напрямую клиентом бессмысленно и запрещается триггером-стражем: баланс меняют только функции движения.

### 5.7 `tasks`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid | |
| `title` | text not null | `length between 1 and 300` |
| `description` | text | |
| `category_id` | uuid null | FK составной → `categories(id, project_id)`, on delete set null |
| `status` | task_status not null default `'new'` | |
| `planned_date` | date null | **кеш** — последняя дата из `task_schedule` (null, если последний день отложен), поддерживается триггером |
| `completed_at` | timestamptz null | |
| `created_by` | uuid | FK → `profiles(id)` |
| `created_at`, `updated_at` | timestamptz | |

Ограничения: `completed_at is not null` тогда и только тогда, когда `status = 'completed'`.

Индексы:
* `(project_id, planned_date)` — доска и backlog;
* `(project_id, status)`;
* `(project_id, category_id)`.

Колонка `planned_date` **производная**: изменять её напрямую нельзя, она пересчитывается триггером от `task_schedule`. Она существует ради двух частых запросов — «текущие заявки» (`planned_date is null`) и «на какой день задача запланирована сейчас» — без подзапросов.

Поля `position` в `tasks` нет: позиция задачи зависит от дня, поэтому живёт в `task_schedule`.

### 5.8 `task_schedule` — дни работы над задачей

Ключевая таблица планирования. Согласованное правило: задача видна **во всех** днях, в которых над ней работали.

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid | |
| `task_id` | uuid | составной FK → `tasks(id, project_id)` on delete cascade |
| `work_date` | date not null | |
| `position` | int not null default 0 | порядок внутри дня |
| `carried_over` | boolean not null default false | `true` — день добавлен переносом (или продолжением отложенной задачи), а не первичным планированием |
| `postponed` | boolean not null default false | `true` — после этого дня задача была отложена (возвращена в «Текущие заявки»), миграция `0008` |
| `note` | text | причина переноса, опционально |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

Ограничения: `unique (task_id, work_date)`.
Индексы: `(project_id, work_date, position)` — основной запрос доски; `(task_id)`.

Эта таблица одновременно является **историей переносов**: последовательность `work_date` с признаком `carried_over` и `created_by` полностью описывает, как задача двигалась по дням. Отдельная таблица `task_transfers` не нужна.

Триггер `after insert/delete/update of work_date, postponed, task_id`: пересчитывает `tasks.planned_date` = `work_date` последнего дня, либо `null`, если дней нет или последний день `postponed`. Смена одной `position` триггер не вызывает; `tasks` обновляется только при фактическом изменении значения.

#### RPC перемещения на доске (`0008`)

Все — `SECURITY INVOKER`: доступ проверяют те же RLS-политики. Исключения — стабильные коды (`task_not_found`, `task_has_history`, …), переводятся в текст в `lib/errors.ts::mapBoardMoveError`.

| Функция | Что делает |
|---|---|
| `plan_task_on_day(p_task_id, p_work_date, p_position default null)` | задача из «Текущих заявок» → день; дата не раньше последнего дня истории; тот же день снимает `postponed`; `new` → `planned` |
| `move_task_schedule(p_task_id, p_from_date, p_to_date, p_position)` | порядок внутри дня или смена дня (только для единственного неотложенного дня задачи) |
| `return_task_to_backlog(p_task_id) returns boolean` | правило «Отложить» (product-requirements.md §4.4); `true` — история сохранена |
| `move_board_item(p_item_id, p_position)` | порядок записи внутри списка |

Позиции перенумеровываются `0..n-1` одним `UPDATE`. Конкурентные перестановки одного дня/списка сериализуются `pg_advisory_xact_lock` (строк дня может ещё не быть, `FOR UPDATE` не подходит), строка задачи блокируется `FOR UPDATE`. Служебные функции `private.lock_board_container` и `private.place_task_in_day` лежат в схеме `private`, которая не публикуется через API.

### 5.9 `task_executors`

| Поле | Тип |
|---|---|
| `task_id` uuid, `executor_id` uuid, `project_id` uuid, `created_at` timestamptz |

PK: `(task_id, executor_id)`. Составные FK на `tasks` и `executors`. Индекс: `(executor_id)`.

### 5.10 `task_materials` — фактический расход в задаче

Редактируемая строка расхода, с которой работает мастер.

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid | |
| `task_id` | uuid | составной FK → `tasks`, on delete cascade |
| `material_id` | uuid | составной FK → `materials`, on delete restrict |
| `quantity` | numeric(14,3) not null | `check (quantity > 0)` |
| `note` | text | |
| `created_by` | uuid | |
| `created_at`, `updated_at` | timestamptz | |

Ограничения: `unique (task_id, material_id)` — один материал в задаче одной строкой.
Индексы: `(material_id)`.

`planned_quantity` отсутствует намеренно (требование §21 CLAUDE.md).

### 5.11 `material_movements` — append-only журнал

| Поле | Тип | Примечание |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid | |
| `material_id` | uuid | составной FK → `materials`, on delete restrict |
| `kind` | movement_kind not null | |
| `quantity` | numeric(14,3) not null | знаковая величина: приход `> 0`, расход `< 0`, корректировка — дельта, `check (quantity <> 0)` |
| `task_id` | uuid null | составной FK → `tasks`; обязателен при `kind = 'consumption'` |
| `task_material_id` | uuid null | источник записи, для трассировки правок |
| `note` | text | |
| `occurred_at` | timestamptz not null default now() | |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

Ограничение: `check (kind <> 'consumption' or task_id is not null)`.
Индексы: `(project_id, occurred_at)`, `(material_id, occurred_at)`, `(task_id)`.

Таблица неизменяема: UPDATE и DELETE запрещены для всех, INSERT возможен **только** из `SECURITY DEFINER` функций. Это основа будущих месячных отчётов.

### 5.12 `board_lists` и `board_items` — дополнительные списки

`board_lists`: `id`, `project_id`, `name`, `sort_order`, `is_system boolean`, timestamps.
Создаются триггером при создании проекта: «Материалы к заказу», «Напоминания», «Мероприятия». Системные списки нельзя удалить, можно переименовать.

`board_items`: `id`, `project_id`, `list_id` (составной FK), `title`, `note`, `is_done boolean default false`, `due_date date null`, `position int`, `created_by`, timestamps.
Индексы: `(project_id, list_id, position)`.

Модель универсальна: пользовательские списки в будущем — просто `board_lists` с `is_system = false`, без миграции.

## 6. RLS

### 6.1 Проблема рекурсии и её решение

Если policy на `projects` читает `project_members`, а policy на `project_members` читает `projects`, PostgreSQL уходит в бесконечную рекурсию. Поэтому доступ определяется одной `SECURITY DEFINER` функцией, которая читает членство **в обход RLS**:

```sql
create or replace function public.project_access(p_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = (select auth.uid())
$$;

revoke all on function public.project_access(uuid) from public;
grant execute on function public.project_access(uuid) to authenticated;
```

### 6.2 Шаблон политики для таблиц проекта

Для `categories`, `executors`, `materials`, `tasks`, `task_schedule`, `task_executors`, `task_materials`, `board_lists`, `board_items`:

```sql
alter table public.<t> enable row level security;

create policy "<t>_select" on public.<t> for select to authenticated
  using (public.project_access(project_id) is not null);

create policy "<t>_insert" on public.<t> for insert to authenticated
  with check (public.project_access(project_id) is not null);

create policy "<t>_update" on public.<t> for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

create policy "<t>_delete" on public.<t> for delete to authenticated
  using (public.project_access(project_id) is not null);
```

Исключения:

| Таблица | Отличие |
|---|---|
| `projects` | UPDATE/DELETE только при `project_access(id) = 'owner'`; INSERT с `owner_id = auth.uid()` |
| `project_members` | изменения только владельцем |
| `material_movements` | только SELECT; INSERT/UPDATE/DELETE не имеют policy вовсе |
| `profiles` | доступ только к собственной строке |

`auth.uid()` всегда оборачивается в `(select auth.uid())`, иначе функция вычисляется для каждой строки.

### 6.3 Что гарантируется

Пользователь B не может прочитать, изменить или удалить проект, задачу, материал, остаток, расписание или список пользователя A, даже подставляя чужие идентификаторы напрямую в запрос: проверка выполняется в PostgreSQL, а разнопроектные связи невозможны из-за составных FK.

`SECURITY DEFINER` функции, доступные клиенту, **обязаны** проверять `project_access` внутри себя — иначе они становятся дырой в обход RLS.

## 7. Материальные операции

### 7.1 Атомарность

Изменение остатка и запись в журнал выполняются **одним триггером** на `task_materials` (`AFTER INSERT / UPDATE / DELETE`), объявленным как `SECURITY DEFINER`:

| Событие | Движение | Изменение баланса |
|---|---|---|
| INSERT строки расхода | `consumption`, `quantity = -q` | `current_balance - q` |
| UPDATE количества `q → q'` | `adjustment`, `quantity = -(q' - q)` | `current_balance - (q' - q)` |
| DELETE строки | `adjustment`, `quantity = +q` | `current_balance + q` |

Ситуация «расход записался, но остаток не изменился» невозможна: обе операции находятся в одной транзакции, и клиент не может выполнить их по отдельности.

Приход и ручная корректировка (полноценный UI отложен) — RPC `record_material_movement(p_material_id, p_kind, p_quantity, p_note)`, `SECURITY DEFINER`, с проверкой `project_access` первой строкой. Единственное текущее место вызова — поле «Начальный остаток» в форме создания материала (kind = `receipt`), чтобы новый материал сразу можно было списывать в задаче.

### 7.2 Race conditions

Баланс всегда меняется выражением вида

```sql
update materials set current_balance = current_balance + delta where id = p_material_id;
```

а не чтением значения в приложение и записью обратно. PostgreSQL блокирует строку на время обновления, поэтому два одновременных списания одного материала сериализуются и не теряют друг друга.

### 7.3 Отрицательный остаток

Разрешён осознанно: материал физически потрачен, даже если приход не успели занести. `CHECK (current_balance >= 0)` **не** создаётся. Приложение показывает предупреждение при списании больше остатка и отдельно — при `current_balance <= minimum_balance`.

### 7.4 Почему не одна таблица и не event sourcing

* Только `current_balance` — нет истории, будущие месячные отчёты невозможны.
* Только журнал, без `task_materials` — мастеру нужно править строку «2 кг → 3 кг», а журнал обязан оставаться неизменяемым; правка превратилась бы в удаление записей аудита.
* Чистый event sourcing (баланс всегда вычисляется агрегатом) — каждый показ доски и каждая проверка низкого остатка стали бы агрегацией всей истории. Для MVP избыточно.

Выбранный вариант — редактируемая строка расхода + неизменяемый журнал + кешированный баланс — сохраняет и удобство, и аудит, и производительность.

## 8. Рабочие дни в БД

Функция `next_working_day(d date) returns date`, `immutable`: пропускает субботу и воскресенье. В MVP используется только для серверных операций; основной расчёт для UI — в `lib/business/working-days.ts`. Праздники добавляются позже отдельной таблицей `holidays (project_id, date)` без изменения существующих таблиц.

## 9. Миграции

Порядок первой серии:

1. `0001_extensions_and_enums` — `pgcrypto`, enum-типы, общий триггер `set_updated_at`.
2. `0002_profiles_and_projects` — `profiles`, `projects`, `project_members`, функция `project_access`, триггер создания владельца, RLS.
3. `0003_reference_data` — `categories`, `executors`, `materials`, RLS, индексы.
4. `0004_tasks` — `tasks`, `task_schedule`, `task_executors`, триггер `planned_date`, RLS.
5. `0005_materials_flow` — `task_materials`, `material_movements`, триггеры баланса, RPC движения, RLS.
6. `0006_board_lists` — `board_lists`, `board_items`, засев системных списков, RLS.
7. `0007_fix_projects_select_returning` — исправление SELECT-политики `projects` для `INSERT … RETURNING`.
8. `0008_board_drag_and_drop` — `task_schedule.postponed`, пересчёт `planned_date` с учётом отложенных задач, RPC перемещения, схема `private`.

Каждая миграция идемпотентна там, где это уместно (`if not exists`, `create or replace`), не удаляет данные и применяется локально через Supabase CLI до применения на удалённой базе.

Миграции применены на локальном стеке и покрыты pgTAP-тестами RLS и RPC в `supabase/tests/database/rls.test.sql` (`supabase test db`, 39/39 успешно). TypeScript-типы сгенерированы в `lib/types/database.ts`.
