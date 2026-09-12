-- Задачи, расписание рабочих дней (оно же история переносов), назначенные исполнители.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  category_id uuid,
  status public.task_status not null default 'new',
  planned_date date,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  check ((status = 'completed') = (completed_at is not null)),
  foreign key (category_id, project_id) references public.categories (id, project_id) on delete set null
);

create index if not exists tasks_project_planned_date_idx on public.tasks (project_id, planned_date);
create index if not exists tasks_project_status_idx on public.tasks (project_id, status);
create index if not exists tasks_project_category_idx on public.tasks (project_id, category_id);

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- planned_date — кеш максимальной work_date из task_schedule, пересчитывается
-- триггером ниже. Прямое изменение клиентом запрещено этим триггером-стражем.

create or replace function public.guard_tasks_planned_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.planned_date is distinct from old.planned_date
     and coalesce(current_setting('repair_planner.planned_date_update', true), '') <> 'on' then
    raise exception 'planned_date is derived from task_schedule and cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_planned_date on public.tasks;
create trigger tasks_guard_planned_date
  before update on public.tasks
  for each row execute function public.guard_tasks_planned_date();

alter table public.tasks enable row level security;

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Дни работы над задачей. Задача видна во всех днях, в которых над ней работали;
-- последовательность work_date с carried_over одновременно является историей переносов.

create table if not exists public.task_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid not null,
  work_date date not null,
  position int not null default 0,
  carried_over boolean not null default false,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (task_id, work_date),
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade
);

create index if not exists task_schedule_project_work_date_idx on public.task_schedule (project_id, work_date, position);
create index if not exists task_schedule_task_idx on public.task_schedule (task_id);

alter table public.task_schedule enable row level security;

drop policy if exists "task_schedule_select" on public.task_schedule;
create policy "task_schedule_select" on public.task_schedule for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "task_schedule_insert" on public.task_schedule;
create policy "task_schedule_insert" on public.task_schedule for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_schedule_update" on public.task_schedule;
create policy "task_schedule_update" on public.task_schedule for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_schedule_delete" on public.task_schedule;
create policy "task_schedule_delete" on public.task_schedule for delete to authenticated
  using (public.project_access(project_id) is not null);

-- Пересчёт tasks.planned_date = max(work_date) при любом изменении расписания.

create or replace function public.recalc_task_planned_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
begin
  perform set_config('repair_planner.planned_date_update', 'on', true);

  update public.tasks
    set planned_date = (select max(work_date) from public.task_schedule where task_id = v_task_id)
    where id = v_task_id;

  return null;
end;
$$;

drop trigger if exists task_schedule_recalc_planned_date on public.task_schedule;
create trigger task_schedule_recalc_planned_date
  after insert or update or delete on public.task_schedule
  for each row execute function public.recalc_task_planned_date();

-- Назначенные исполнители

create table if not exists public.task_executors (
  task_id uuid not null,
  executor_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, executor_id),
  foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  foreign key (executor_id, project_id) references public.executors (id, project_id) on delete cascade
);

create index if not exists task_executors_executor_idx on public.task_executors (executor_id);

alter table public.task_executors enable row level security;

drop policy if exists "task_executors_select" on public.task_executors;
create policy "task_executors_select" on public.task_executors for select to authenticated
  using (public.project_access(project_id) is not null);

drop policy if exists "task_executors_insert" on public.task_executors;
create policy "task_executors_insert" on public.task_executors for insert to authenticated
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_executors_update" on public.task_executors;
create policy "task_executors_update" on public.task_executors for update to authenticated
  using (public.project_access(project_id) is not null)
  with check (public.project_access(project_id) is not null);

drop policy if exists "task_executors_delete" on public.task_executors;
create policy "task_executors_delete" on public.task_executors for delete to authenticated
  using (public.project_access(project_id) is not null);
