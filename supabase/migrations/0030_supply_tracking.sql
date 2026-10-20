-- Снабжение: заявки на ТМЦ, оплачиваемые счета, поставки по УПД и
-- оприходование на остаток (docs/superpowers/specs/2026-10-20-supply-tracking-design.md).
--
-- Цепочка: заявка → позиции; заявка → счета → строки счёта (как в документе,
-- с необязательной привязкой к позиции этой же заявки); счёт → поставки →
-- строки поставки (сколько привезли по строке счёта). Целостность — составными
-- FK, без триггеров: строку счёта нельзя привязать к позиции другой заявки,
-- строку поставки — к строке другого счёта. Статусы не хранятся, а
-- вычисляются в приложении (lib/business/supply-status.ts).
--
-- Права, как у остальных данных проекта: читают все участники
-- (project_access), меняют владелец и редактор (project_can_edit).

-- ================= supply_requests =================

create table if not exists public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number text not null check (char_length(btrim(number)) between 1 and 60),
  request_date date not null,
  description text check (description is null or char_length(description) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create index if not exists supply_requests_project_date_idx
  on public.supply_requests (project_id, request_date desc);

-- ================= supply_request_items =================

create table if not exists public.supply_request_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  request_id uuid not null,
  line_no int not null check (line_no >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 300),
  unit text not null check (char_length(btrim(unit)) between 1 and 30),
  quantity numeric(14, 3) not null check (quantity > 0),
  note text check (note is null or char_length(note) <= 300),
  -- Подсказка для оприходования: какой материал справочника обычно приходует эта позиция.
  material_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  -- Цель FK строк счёта: позиция той же заявки.
  unique (id, request_id),
  constraint supply_request_items_request_fk
    foreign key (request_id, project_id) references public.supply_requests (id, project_id) on delete cascade,
  constraint supply_request_items_material_fk
    foreign key (material_id, project_id) references public.materials (id, project_id)
    on delete set null (material_id)
);

create index if not exists supply_request_items_request_idx
  on public.supply_request_items (request_id, line_no);
create index if not exists supply_request_items_material_idx
  on public.supply_request_items (material_id) where material_id is not null;

-- ================= supply_invoices =================
-- Только счета, которые цех оплачивает (отклонённые не хранятся).

create table if not exists public.supply_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  request_id uuid not null,
  number text not null check (char_length(btrim(number)) between 1 and 60),
  invoice_date date not null,
  supplier text not null check (char_length(btrim(supplier)) between 1 and 200),
  amount numeric(14, 2) check (amount is null or amount >= 0),
  paid_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (id, request_id),
  constraint supply_invoices_request_fk
    foreign key (request_id, project_id) references public.supply_requests (id, project_id) on delete cascade
);

create index if not exists supply_invoices_request_idx on public.supply_invoices (request_id, invoice_date);

-- ================= supply_invoice_lines =================
-- Строка «как в документе»: наименование, единица и количество поставщика.
-- request_id — денормализация ради целостности привязки к позиции.

create table if not exists public.supply_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  invoice_id uuid not null,
  request_id uuid not null,
  request_item_id uuid,
  line_no int not null check (line_no >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 300),
  unit text not null check (char_length(btrim(unit)) between 1 and 30),
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (id, invoice_id),
  constraint supply_invoice_lines_invoice_fk
    foreign key (invoice_id, request_id) references public.supply_invoices (id, request_id) on delete cascade,
  -- Позиция только этой же заявки; при удалении позиции строка становится «вне заявки».
  constraint supply_invoice_lines_item_fk
    foreign key (request_item_id, request_id) references public.supply_request_items (id, request_id)
    on delete set null (request_item_id),
  constraint supply_invoice_lines_request_fk
    foreign key (request_id, project_id) references public.supply_requests (id, project_id) on delete cascade
);

create index if not exists supply_invoice_lines_invoice_idx on public.supply_invoice_lines (invoice_id, line_no);
create index if not exists supply_invoice_lines_item_idx
  on public.supply_invoice_lines (request_item_id) where request_item_id is not null;
create index if not exists supply_invoice_lines_request_idx on public.supply_invoice_lines (request_id);

-- ================= supply_deliveries =================

create table if not exists public.supply_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  invoice_id uuid not null,
  number text not null check (char_length(btrim(number)) between 1 and 60),
  delivery_date date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (id, invoice_id),
  constraint supply_deliveries_invoice_fk
    foreign key (invoice_id, project_id) references public.supply_invoices (id, project_id) on delete cascade
);

create index if not exists supply_deliveries_invoice_idx on public.supply_deliveries (invoice_id, delivery_date);

-- ================= supply_delivery_lines =================
-- Количество — в единицах строки счёта. Перепоставка разрешена.

create table if not exists public.supply_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  delivery_id uuid not null,
  invoice_id uuid not null,
  invoice_line_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (delivery_id, invoice_line_id),
  constraint supply_delivery_lines_delivery_fk
    foreign key (delivery_id, invoice_id) references public.supply_deliveries (id, invoice_id) on delete cascade,
  -- Строка только того же счёта, что и поставка.
  constraint supply_delivery_lines_invoice_line_fk
    foreign key (invoice_line_id, invoice_id) references public.supply_invoice_lines (id, invoice_id) on delete cascade,
  constraint supply_delivery_lines_invoice_fk
    foreign key (invoice_id, project_id) references public.supply_invoices (id, project_id) on delete cascade
);

create index if not exists supply_delivery_lines_line_idx on public.supply_delivery_lines (invoice_line_id);
create index if not exists supply_delivery_lines_invoice_idx on public.supply_delivery_lines (invoice_id);

-- ================= updated_at =================

do $$
declare
  t text;
begin
  foreach t in array array[
    'supply_requests', 'supply_request_items', 'supply_invoices',
    'supply_invoice_lines', 'supply_deliveries', 'supply_delivery_lines'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- ================= RLS =================

do $$
declare
  t text;
begin
  foreach t in array array[
    'supply_requests', 'supply_request_items', 'supply_invoices',
    'supply_invoice_lines', 'supply_deliveries', 'supply_delivery_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.project_access(project_id) is not null)',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.project_can_edit(project_id))',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.project_can_edit(project_id))
         with check (public.project_can_edit(project_id))',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.project_can_edit(project_id))',
      t || '_delete', t
    );

    -- project_id и ссылки на родителя неизменяемы: UPDATE только на
    -- перечисленные ниже колонки (как task_queues в 0018).
    execute format('revoke update on public.%I from authenticated, anon', t);
  end loop;
end;
$$;

grant update (number, request_date, description) on public.supply_requests to authenticated;
grant update (line_no, name, unit, quantity, note, material_id, cancelled_at) on public.supply_request_items to authenticated;
grant update (number, invoice_date, supplier, amount, paid_on) on public.supply_invoices to authenticated;
grant update (line_no, name, unit, quantity, request_item_id) on public.supply_invoice_lines to authenticated;
grant update (number, delivery_date) on public.supply_deliveries to authenticated;
grant update (quantity) on public.supply_delivery_lines to authenticated;

-- ================= material_movements: оприходование строки поставки =================
-- Ссылка из неизменяемого журнала. no action (а не restrict): проверка в конце
-- оператора, поэтому каскадное удаление проекта проходит, а удаление
-- оприходованной строки поставки (и её поставки, счёта, заявки) — нет.

alter table public.material_movements add column if not exists supply_delivery_line_id uuid;

alter table public.material_movements drop constraint if exists material_movements_supply_line_fk;
alter table public.material_movements
  add constraint material_movements_supply_line_fk
    foreign key (supply_delivery_line_id, project_id)
    references public.supply_delivery_lines (id, project_id) on delete no action;

alter table public.material_movements drop constraint if exists material_movements_supply_receipt_check;
alter table public.material_movements
  add constraint material_movements_supply_receipt_check
    check (supply_delivery_line_id is null or kind = 'receipt');

-- Одна строка поставки оприходуется один раз; закрывает и гонку двух вызовов.
create unique index if not exists material_movements_supply_line_key
  on public.material_movements (supply_delivery_line_id) where supply_delivery_line_id is not null;

comment on column public.material_movements.supply_delivery_line_id is
  'Строка поставки (УПД), по которой оприходован приход; только для kind = receipt';
