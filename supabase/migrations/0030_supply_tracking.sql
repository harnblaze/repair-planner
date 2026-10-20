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

-- ================= RPC =================
-- Коды исключений — стабильные строки, приложение переводит их в понятные
-- сообщения (lib/errors.ts, mapSupplyError).
--
-- Создание документа вместе со строками — одной транзакцией (CLAUDE.md §23).
-- security invoker: вставки проходят через RLS, как обычные запросы; функция
-- даёт только атомарность. Невидимый по RLS родитель — supply_parent_not_found.

create or replace function public.create_supply_request(
  p_project_id uuid,
  p_number text,
  p_request_date date,
  p_description text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  insert into public.supply_requests (project_id, number, request_date, description, created_by)
  values (p_project_id, btrim(p_number), p_request_date, nullif(btrim(p_description), ''), (select auth.uid()))
  returning id into v_request_id;

  insert into public.supply_request_items (project_id, request_id, line_no, name, unit, quantity, note)
  select p_project_id, v_request_id, x.line_no, btrim(x.name), btrim(x.unit), x.quantity, nullif(btrim(x.note), '')
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(line_no int, name text, unit text, quantity numeric, note text);

  return v_request_id;
end;
$$;

create or replace function public.create_supply_invoice(
  p_request_id uuid,
  p_number text,
  p_invoice_date date,
  p_supplier text,
  p_amount numeric,
  p_paid_on date,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_invoice_id uuid;
begin
  select project_id into v_project_id from public.supply_requests where id = p_request_id;

  if v_project_id is null then
    raise exception 'supply_parent_not_found';
  end if;

  insert into public.supply_invoices
    (project_id, request_id, number, invoice_date, supplier, amount, paid_on, created_by)
  values
    (v_project_id, p_request_id, btrim(p_number), p_invoice_date, btrim(p_supplier), p_amount, p_paid_on,
     (select auth.uid()))
  returning id into v_invoice_id;

  -- Чужая позиция (другой заявки) отвергается FK supply_invoice_lines_item_fk.
  insert into public.supply_invoice_lines
    (project_id, invoice_id, request_id, request_item_id, line_no, name, unit, quantity)
  select v_project_id, v_invoice_id, p_request_id, x.request_item_id, x.line_no, btrim(x.name), btrim(x.unit), x.quantity
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as x(line_no int, name text, unit text, quantity numeric, request_item_id uuid);

  return v_invoice_id;
end;
$$;

create or replace function public.create_supply_delivery(
  p_invoice_id uuid,
  p_number text,
  p_delivery_date date,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_delivery_id uuid;
begin
  select project_id into v_project_id from public.supply_invoices where id = p_invoice_id;

  if v_project_id is null then
    raise exception 'supply_parent_not_found';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'supply_lines_empty';
  end if;

  insert into public.supply_deliveries (project_id, invoice_id, number, delivery_date, created_by)
  values (v_project_id, p_invoice_id, btrim(p_number), p_delivery_date, (select auth.uid()))
  returning id into v_delivery_id;

  -- Строка другого счёта отвергается FK supply_delivery_lines_invoice_line_fk.
  insert into public.supply_delivery_lines (project_id, delivery_id, invoice_id, invoice_line_id, quantity)
  select v_project_id, v_delivery_id, p_invoice_id, x.invoice_line_id, x.quantity
  from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, quantity numeric);

  return v_delivery_id;
end;
$$;

-- Оприходование строки поставки: приход на материал справочника в его
-- единицах. security definer — вставка в material_movements без policy, как
-- record_material_movement (0010); поэтому доступ проверяется явно. Отсутствие
-- строки и отсутствие доступа к её проекту дают один код, чтобы нельзя было
-- узнать, существует ли чужая строка.

create or replace function public.receive_supply_delivery_line(
  p_delivery_line_id uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns public.material_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_delivery_number text;
  v_delivery_date date;
  v_invoice_number text;
  v_movement public.material_movements;
begin
  select dl.project_id, d.number, d.delivery_date, i.number
    into v_project_id, v_delivery_number, v_delivery_date, v_invoice_number
  from public.supply_delivery_lines dl
  join public.supply_deliveries d on d.id = dl.delivery_id
  join public.supply_invoices i on i.id = dl.invoice_id
  where dl.id = p_delivery_line_id;

  if v_project_id is null or public.project_access(v_project_id) is null then
    raise exception 'supply_line_not_found';
  end if;

  if not public.project_can_edit(v_project_id) then
    raise exception 'access_denied';
  end if;

  if not exists (
    select 1 from public.materials m where m.id = p_material_id and m.project_id = v_project_id
  ) then
    raise exception 'material_not_found';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  -- Блокировка строки поставки: второй одновременный вызов ждёт и видит
  -- уже записанное движение. Уникальный индекс страхует то же самое.
  perform 1 from public.supply_delivery_lines where id = p_delivery_line_id for update;

  if exists (
    select 1 from public.material_movements mm where mm.supply_delivery_line_id = p_delivery_line_id
  ) then
    raise exception 'already_received';
  end if;

  perform set_config('repair_planner.balance_update', 'on', true);

  update public.materials
    set current_balance = current_balance + p_quantity
    where id = p_material_id;

  insert into public.material_movements
    (project_id, material_id, kind, quantity, note, supply_delivery_line_id, created_by)
  values
    (v_project_id, p_material_id, 'receipt', p_quantity,
     coalesce(
       nullif(btrim(p_note), ''),
       'УПД №' || v_delivery_number || ' от ' || to_char(v_delivery_date, 'DD.MM.YYYY')
         || ', счёт №' || v_invoice_number
     ),
     p_delivery_line_id, (select auth.uid()))
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function public.create_supply_request(uuid, text, date, text, jsonb) from public, anon;
grant execute on function public.create_supply_request(uuid, text, date, text, jsonb) to authenticated;
revoke all on function public.create_supply_invoice(uuid, text, date, text, numeric, date, jsonb) from public, anon;
grant execute on function public.create_supply_invoice(uuid, text, date, text, numeric, date, jsonb) to authenticated;
revoke all on function public.create_supply_delivery(uuid, text, date, jsonb) from public, anon;
grant execute on function public.create_supply_delivery(uuid, text, date, jsonb) to authenticated;
revoke all on function public.receive_supply_delivery_line(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.receive_supply_delivery_line(uuid, uuid, numeric, text) to authenticated;

-- ================= Оприходованная строка поставки неизменна =================
-- Количество строки поставки, по которой уже записан приход, не меняется:
-- иначе документ разойдётся с остатком (старая вкладка, прямой запрос).
-- Удаление такой строки запрещает FK material_movements_supply_line_fk.

create or replace function private.guard_received_supply_delivery_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity and exists (
    select 1 from public.material_movements mm where mm.supply_delivery_line_id = old.id
  ) then
    raise exception 'already_received';
  end if;
  return new;
end;
$$;

drop trigger if exists supply_delivery_lines_guard_received on public.supply_delivery_lines;
create trigger supply_delivery_lines_guard_received
  before update of quantity on public.supply_delivery_lines
  for each row execute function private.guard_received_supply_delivery_line();
