-- Праздники и производственный календарь (docs/database.md §5.13, §8).
--
-- Базовое правило рабочих дней не хранится: Пн–Пт — рабочие, Сб и Вс — выходные.
-- В project_calendar_days записываются только исключения из него:
-- * holiday     — нерабочий день, выпавший на Пн–Пт (праздник или перенесённый выходной);
-- * working_day — рабочая суббота (перенос выходного).
-- Рабочее воскресенье не поддерживается: на доске нет колонки «Вс».
--
-- Проверка рабочего дня переезжает из RPC (0008, extract(isodow) > 5) в одну
-- функцию private.is_working_day и дополнительно закрепляется триггером на
-- task_schedule — прямые вставки расписания (перенос, дата в карточке) раньше
-- в БД не проверялись вовсе.
-- Коды исключений — стабильные строки, их переводит lib/errors.ts.

do $$
begin
  create type public.calendar_day_kind as enum ('holiday', 'working_day');
exception
  when duplicate_object then null;
end
$$;

-- ================= Таблица исключений =================

create table if not exists public.project_calendar_days (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  day date not null,
  kind public.calendar_day_kind not null,
  name text check (name is null or char_length(name) between 1 and 120),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, day),
  -- Исключение должно менять базовое правило, иначе оно бессмысленно и
  -- неоднозначно (праздник в воскресенье, «рабочий» вторник).
  constraint project_calendar_days_kind_matches_weekday check (
    (kind = 'holiday' and extract(isodow from day) <= 5)
    or (kind = 'working_day' and extract(isodow from day) = 6)
  )
);

comment on table public.project_calendar_days is
  'Исключения из правила Пн–Пт: нерабочие будни и рабочие субботы проекта';

-- unique (project_id, day) уже даёт индекс для выборки диапазона дат проекта.

drop trigger if exists project_calendar_days_set_updated_at on public.project_calendar_days;
create trigger project_calendar_days_set_updated_at
  before update on public.project_calendar_days
  for each row execute function public.set_updated_at();

alter table public.project_calendar_days enable row level security;

-- SELECT — любой участник проекта (календарь нужен для отображения доски);
-- INSERT/UPDATE/DELETE — owner и member, как остальные данные проекта (0012).

drop policy if exists "project_calendar_days_select" on public.project_calendar_days;
create policy "project_calendar_days_select" on public.project_calendar_days for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "project_calendar_days_insert" on public.project_calendar_days;
create policy "project_calendar_days_insert" on public.project_calendar_days for insert to authenticated
  with check (public.project_can_edit(project_id));

drop policy if exists "project_calendar_days_update" on public.project_calendar_days;
create policy "project_calendar_days_update" on public.project_calendar_days for update to authenticated
  using (public.project_can_edit(project_id))
  with check (public.project_can_edit(project_id));

drop policy if exists "project_calendar_days_delete" on public.project_calendar_days;
create policy "project_calendar_days_delete" on public.project_calendar_days for delete to authenticated
  using (public.project_can_edit(project_id));

-- ================= Рабочие дни =================

-- Security invoker: календарь читается через RLS. Все вызывающие (RPC доски,
-- триггер расписания) уже требуют доступа к проекту, поэтому видят его календарь.
-- Логика синхронизирована с lib/business/working-days.ts::isWorkingDay.
create or replace function private.is_working_day(p_project_id uuid, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.kind = 'working_day'
       from public.project_calendar_days c
       where c.project_id = p_project_id and c.day = p_day),
    extract(isodow from p_day) <= 5
  );
$$;

-- Следующий рабочий день после p_day. Горизонт поиска ограничен, чтобы
-- ошибочно заполненный календарь не зациклил функцию.
-- Логика синхронизирована с lib/business/working-days.ts::nextWorkingDay.
create or replace function private.next_working_day(p_project_id uuid, p_day date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day date := p_day;
begin
  for i in 1..366 loop
    v_day := v_day + 1;
    if private.is_working_day(p_project_id, v_day) then
      return v_day;
    end if;
  end loop;

  raise exception 'no_working_day';
end;
$$;

-- Функция 0006 календарь не учитывает и нигде не используется — удаляется,
-- чтобы не осталось второго, расходящегося правила.
drop function if exists public.next_working_day(date);

revoke all on function private.is_working_day(uuid, date) from public, anon;
revoke all on function private.next_working_day(uuid, date) from public, anon;
grant execute on function private.is_working_day(uuid, date) to authenticated;
grant execute on function private.next_working_day(uuid, date) to authenticated;

-- ================= Проверка расписания =================

-- Новый день расписания — только рабочий. Уже существующие строки не
-- проверяются: если день позже объявили нерабочим, задачи остаются на месте
-- (решение этапа, docs/product-requirements.md §4.1) и их можно упорядочить.
create or replace function private.check_task_schedule_working_day()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.work_date = old.work_date then
    return new;
  end if;
  if not private.is_working_day(new.project_id, new.work_date) then
    raise exception 'not_working_day';
  end if;
  return new;
end;
$$;

revoke all on function private.check_task_schedule_working_day() from public, anon;
grant execute on function private.check_task_schedule_working_day() to authenticated;

drop trigger if exists task_schedule_check_working_day on public.task_schedule;
create trigger task_schedule_check_working_day
  before insert or update of work_date on public.task_schedule
  for each row execute function private.check_task_schedule_working_day();

-- ================= RPC доски (тела из 0008) =================

-- Изменилась только проверка рабочего дня: календарь проекта вместо isodow.
-- Проверка выполняется после чтения задачи — до этого project_id неизвестен.
create or replace function public.plan_task_on_day(
  p_task_id uuid,
  p_work_date date,
  p_position int default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_last record;
  v_has_history boolean;
  v_schedule_id uuid;
begin
  if p_work_date is null then
    raise exception 'not_working_day';
  end if;

  select t.id, t.project_id, t.status, t.planned_date
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;
  if not private.is_working_day(v_task.project_id, p_work_date) then
    raise exception 'not_working_day';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;
  if v_task.planned_date is not null then
    raise exception 'task_already_planned';
  end if;

  perform private.lock_board_container('day', v_task.project_id, p_work_date::text);

  select s.id, s.work_date
    into v_last
    from public.task_schedule s
    where s.task_id = p_task_id
    order by s.work_date desc
    limit 1;

  v_has_history := found;

  if v_has_history and p_work_date < v_last.work_date then
    raise exception 'date_before_history';
  end if;

  if v_has_history and p_work_date = v_last.work_date then
    update public.task_schedule set postponed = false where id = v_last.id;
    v_schedule_id := v_last.id;
  else
    insert into public.task_schedule (project_id, task_id, work_date, carried_over, created_by)
      values (v_task.project_id, p_task_id, p_work_date, v_has_history, (select auth.uid()))
      returning id into v_schedule_id;
  end if;

  perform private.place_task_in_day(v_task.project_id, p_work_date, v_schedule_id, p_position);

  if v_task.status = 'new' then
    update public.tasks set status = 'planned' where id = p_task_id;
  end if;
end;
$$;

-- Порядок внутри дня разрешён и в нерабочий день: задачи, запланированные до
-- того, как день объявили нерабочим, остаются на месте и должны упорядочиваться.
create or replace function public.move_task_schedule(
  p_task_id uuid,
  p_from_date date,
  p_to_date date,
  p_position int
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_row record;
begin
  if p_to_date is null then
    raise exception 'not_working_day';
  end if;

  select t.id, t.project_id
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;

  select s.id, s.postponed
    into v_row
    from public.task_schedule s
    where s.task_id = p_task_id and s.work_date = p_from_date;

  if not found then
    raise exception 'schedule_not_found';
  end if;

  -- Блокировки берутся в порядке дат, чтобы встречные перемещения не взаимоблокировались.
  perform private.lock_board_container('day', v_task.project_id, least(p_from_date, p_to_date)::text);
  if p_from_date <> p_to_date then
    if not private.is_working_day(v_task.project_id, p_to_date) then
      raise exception 'not_working_day';
    end if;

    perform private.lock_board_container('day', v_task.project_id, greatest(p_from_date, p_to_date)::text);

    if v_row.postponed
       or (select count(*) from public.task_schedule where task_id = p_task_id) > 1 then
      raise exception 'task_has_history';
    end if;

    update public.task_schedule set work_date = p_to_date where id = v_row.id;
  end if;

  perform private.place_task_in_day(v_task.project_id, p_to_date, v_row.id, p_position);
end;
$$;

-- ================= RPC: перенос на следующий рабочий день =================

-- Раньше перенос был прямой вставкой из Server Action: следующий день и позиция
-- считались в приложении. Теперь следующий рабочий день считается по календарю
-- проекта в той же транзакции, позиция — под блокировкой дня.
-- Возвращает дату, на которую перенесена задача.
create or replace function public.carry_over_task(p_task_id uuid)
returns date
language plpgsql
set search_path = ''
as $$
declare
  v_task record;
  v_next date;
  v_schedule_id uuid;
begin
  select t.id, t.project_id, t.status, t.planned_date
    into v_task
    from public.tasks t
    where t.id = p_task_id
    for update;

  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed';
  end if;
  if v_task.planned_date is null then
    raise exception 'task_not_planned';
  end if;

  v_next := private.next_working_day(v_task.project_id, v_task.planned_date);

  perform private.lock_board_container('day', v_task.project_id, v_next::text);

  -- planned_date — последний день расписания, поэтому v_next > любого дня задачи
  -- и unique (task_id, work_date) нарушиться не может.
  insert into public.task_schedule (project_id, task_id, work_date, carried_over, created_by)
    values (v_task.project_id, p_task_id, v_next, true, (select auth.uid()))
    returning id into v_schedule_id;

  perform private.place_task_in_day(v_task.project_id, v_next, v_schedule_id, null);

  return v_next;
end;
$$;

revoke all on function public.plan_task_on_day(uuid, date, int) from public, anon;
revoke all on function public.move_task_schedule(uuid, date, date, int) from public, anon;
revoke all on function public.carry_over_task(uuid) from public, anon;

grant execute on function public.plan_task_on_day(uuid, date, int) to authenticated;
grant execute on function public.move_task_schedule(uuid, date, date, int) to authenticated;
grant execute on function public.carry_over_task(uuid) to authenticated;
