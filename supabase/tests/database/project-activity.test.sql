-- Лента проекта (0032): триггеры журнала, снимок названий, RLS и чистка.
-- Запуск: supabase test db
--
-- pgtap — тестовая утилита, устанавливается только в тестовой среде,
-- не входит в прикладные миграции.
create extension if not exists pgtap with schema extensions;

begin;

select plan(17);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- Владельца в project_members не вставляем: его добавляет триггер проекта.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'activity-owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'activity-member@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Проект журнала');

insert into public.executors (id, project_id, name) values
  ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Иванов Иван');

insert into public.tasks (id, project_id, title) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Починить дверь');

insert into public.materials (id, project_id, name, unit) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Электроды', 'кг');

insert into public.categories (id, project_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Сварочный');

insert into public.board_items (id, project_id, list_id, title)
select 'b0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', l.id, 'Купить диски'
  from public.board_lists l
 where l.project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and l.name = 'Материалы к заказу';

-- ================= Заявка: создание, статус, исполнитель =================

select is(
  (select payload->>'title' from public.project_activity
    where kind = 'task.created' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  'Починить дверь',
  'task.created пишет название заявки'
);

update public.tasks set status = 'planned'
 where id = 'f0000000-0000-4000-8000-000000000001';

select is(
  (select payload->>'from' from public.project_activity
    where kind = 'task.status' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  'new',
  'task.status пишет прежний статус'
);

select is(
  (select payload->>'to' from public.project_activity
    where kind = 'task.status' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  'planned',
  'task.status пишет новый статус'
);

insert into public.task_executors (project_id, task_id, executor_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'f0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001');

select is(
  (select payload->>'executor' from public.project_activity
    where kind = 'task.executor.added' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  'Иванов Иван',
  'task.executor.added пишет имя исполнителя'
);

-- ================= Перенос на следующий день =================

insert into public.task_schedule (project_id, task_id, work_date, carried_over) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-4000-8000-000000000001', '2026-01-05', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-4000-8000-000000000001', '2026-01-06', true);

select is(
  (select payload->>'from_date' from public.project_activity
    where kind = 'task.carried_over' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  '2026-01-05',
  'task.carried_over пишет день, с которого перенесли'
);

select is(
  (select payload->>'to_date' from public.project_activity
    where kind = 'task.carried_over' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  '2026-01-06',
  'task.carried_over пишет день, на который перенесли'
);

-- ================= Пункт списка выполнен =================

update public.board_items set is_done = true
 where id = 'b0000000-0000-4000-8000-000000000001';

select is(
  (select payload->>'list' from public.project_activity
    where kind = 'item.done' and entity_id = 'b0000000-0000-4000-8000-000000000001'),
  'Материалы к заказу',
  'item.done пишет название списка'
);

-- ================= Материал списан =================

insert into public.material_movements (project_id, material_id, kind, quantity, task_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-4000-8000-000000000001', 'consumption', 2.5,
   'f0000000-0000-4000-8000-000000000001');

select is(
  (select (payload->>'quantity')::numeric from public.project_activity
    where kind = 'material.moved' and entity_id = 'c0000000-0000-4000-8000-000000000001'),
  2.5::numeric,
  'material.moved пишет количество'
);

select is(
  (select payload->>'task' from public.project_activity
    where kind = 'material.moved' and entity_id = 'c0000000-0000-4000-8000-000000000001'),
  'Починить дверь',
  'material.moved пишет заявку, на которую списали'
);

-- ================= Справочник архивирован =================

update public.categories set is_archived = true
 where id = 'd0000000-0000-4000-8000-000000000001';

select is(
  (select payload->>'name' from public.project_activity
    where kind = 'category.archived' and entity_id = 'd0000000-0000-4000-8000-000000000001'),
  'Сварочный',
  'category.archived пишет название цеха'
);

-- ================= Участник вошёл =================

update public.profiles set full_name = 'Пётр Сидоров'
 where id = '22222222-2222-2222-2222-222222222222';

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member');

select is(
  (select payload->>'full_name' from public.project_activity
    where kind = 'member.joined' and entity_id = '22222222-2222-2222-2222-222222222222'),
  'Пётр Сидоров',
  'member.joined пишет ФИО участника'
);

-- ================= Снимок названия не переписывается =================

update public.tasks set title = 'Починить дверь (уточнено)'
 where id = 'f0000000-0000-4000-8000-000000000001';

select is(
  (select payload->>'title' from public.project_activity
    where kind = 'task.created' and entity_id = 'f0000000-0000-4000-8000-000000000001'),
  'Починить дверь',
  'переименование заявки не переписывает прошлое событие'
);

-- ================= Клиент не может писать в журнал (RLS) =================

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

select throws_ok(
  $$ insert into public.project_activity (project_id, kind, entity_type)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'fake.created', 'task') $$,
  '42501',
  null,
  'клиент не может вставить событие в журнал'
);

-- Действие участника при этом журналируется: пишет триггер, а не клиент.
update public.tasks set status = 'in_progress'
 where id = 'f0000000-0000-4000-8000-000000000001';

reset role;

-- Запросы ниже обязательно сужены проектом теста: в базе могут лежать живые
-- события других проектов, и без фильтра скалярный подзапрос вернул бы
-- несколько строк.
select is(
  (select actor_id from public.project_activity
    where kind = 'task.status' and payload->>'to' = 'in_progress'
      and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'событие участника записано с ним в actor_id'
);

-- ================= Чистка старше 6 месяцев =================

-- Свежее событие — то, что только что записано действием участника.
update public.project_activity
   set created_at = now() - interval '7 months'
 where kind = 'task.created'
   and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Чистка глобальная (по всем проектам), поэтому возврат проверяем как «хотя бы
-- одно»: в базе могут быть и другие старые события.
select ok(
  public.purge_project_activity() >= 1,
  'purge_project_activity возвращает число удалённых'
);

select is(
  (select count(*)::int from public.project_activity
    where kind = 'task.created' and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'чистка удаляет событие старше полугода'
);

select is(
  (select count(*)::int from public.project_activity
    where kind = 'task.status' and payload->>'to' = 'in_progress'
      and project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'чистка не трогает свежее событие'
);

select * from finish();

rollback;
