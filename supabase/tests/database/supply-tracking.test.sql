-- Снабжение: заявки на ТМЦ, счета, поставки, оприходование (0030,
-- docs/superpowers/specs/2026-10-20-supply-tracking-design.md).
-- Запуск: supabase test db

create extension if not exists pgtap with schema extensions;

begin;

select plan(55);

-- ================= Фикстуры (как postgres, минуя RLS) =================
-- A — владелец PA, B — владелец PB, V — viewer в PA, M — member в PA.
-- PA: заявки R1 (позиция I1, счета INV1 и INV2) и R2 (позиция I2).
-- INV1: строка L1 → I1, поставка D1 со строкой DL1. INV2: строка L2, поставка D2 со строкой DL2.
-- PB: заявка RB, позиция IB, счёт INVB, строка LB, поставка DB, строка DLB.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'supply-owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'supply-owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'supply-viewer-v@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'supply-member-m@example.com');

insert into public.projects (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Supply A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Supply B');

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member');

insert into public.materials (id, project_id, name, unit) values
  ('d1000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Линолеум A', 'м2'),
  ('d1000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Линолеум B', 'м2');

insert into public.supply_requests (id, project_id, number, request_date, description) values
  ('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '14', date '2026-10-01', 'Материалы на кабинет'),
  ('5a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '15', date '2026-10-05', null),
  ('5b000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '1', date '2026-10-01', null);

insert into public.supply_request_items (id, project_id, request_id, line_no, name, unit, quantity) values
  ('6a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000001', 4, 'Линолеум T93 3.5м', 'пог. м', 5.2),
  ('6a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000002', 1, 'Саморезы 35мм', 'шт', 1500),
  ('6b000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '5b000000-0000-0000-0000-000000000001', 1, 'Линолеум', 'м2', 10);

insert into public.supply_invoices (id, project_id, request_id, number, invoice_date, supplier) values
  ('7a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000001', '89598', date '2026-10-08', 'ТД ЦСК'),
  ('7a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000001', '2656', date '2026-10-06', 'Лемана ПРО'),
  ('7b000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '5b000000-0000-0000-0000-000000000001', '1', date '2026-10-08', 'ЦСК');

insert into public.supply_invoice_lines (id, project_id, invoice_id, request_id, request_item_id, line_no, name, unit, quantity) values
  ('8a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7a000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000001', 5, 'Линолеум Т93 3.5м', 'м2', 18.2),
  ('8a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7a000000-0000-0000-0000-000000000002',
   '5a000000-0000-0000-0000-000000000001', null, 1, 'Гвозди 4,0х120', 'упак', 2),
  ('8b000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '7b000000-0000-0000-0000-000000000001',
   '5b000000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-000000000001', 1, 'Линолеум', 'м2', 10);

insert into public.supply_deliveries (id, project_id, invoice_id, number, delivery_date) values
  ('9a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7a000000-0000-0000-0000-000000000001', '84009', date '2026-10-16'),
  ('9a000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7a000000-0000-0000-0000-000000000002', '84089', date '2026-10-19'),
  ('9b000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '7b000000-0000-0000-0000-000000000001', '1', date '2026-10-16');

insert into public.supply_delivery_lines (id, project_id, delivery_id, invoice_id, invoice_line_id, quantity) values
  ('c1000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '9a000000-0000-0000-0000-000000000001',
   '7a000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', 18.2),
  ('c1000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '9a000000-0000-0000-0000-000000000002',
   '7a000000-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-000000000002', 2),
  ('c1000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '9b000000-0000-0000-0000-000000000001',
   '7b000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000001', 10);

-- ================= Структура =================

-- 1-8
select has_table('public', 'supply_requests', 'supply_requests exists');
select has_table('public', 'supply_request_items', 'supply_request_items exists');
select has_table('public', 'supply_invoices', 'supply_invoices exists');
select has_table('public', 'supply_invoice_lines', 'supply_invoice_lines exists');
select has_table('public', 'supply_deliveries', 'supply_deliveries exists');
select has_table('public', 'supply_delivery_lines', 'supply_delivery_lines exists');
select has_column('public', 'material_movements', 'supply_delivery_line_id', 'material_movements.supply_delivery_line_id exists');
select is(
  (select count(*)::int from pg_class
   where relnamespace = 'public'::regnamespace and relname like 'supply\_%' and relkind = 'r' and relrowsecurity),
  6,
  'RLS is enabled on all supply tables'
);

-- ================= Чужой владелец B =================

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 9-14
select is((select count(*)::int from public.supply_requests where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_requests of PA');
select is((select count(*)::int from public.supply_request_items where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_request_items of PA');
select is((select count(*)::int from public.supply_invoices where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_invoices of PA');
select is((select count(*)::int from public.supply_invoice_lines where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_invoice_lines of PA');
select is((select count(*)::int from public.supply_deliveries where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_deliveries of PA');
select is((select count(*)::int from public.supply_delivery_lines where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'B sees no supply_delivery_lines of PA');

-- 15
select throws_ok(
  $$ insert into public.supply_requests (project_id, number, request_date)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'взлом', date '2026-10-20') $$,
  '42501', null,
  'B cannot insert supply_request into PA'
);

-- 16-17
with u as (
  update public.supply_invoices set paid_on = date '2026-10-20'
  where id = '7a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*)::int from u), 0, 'B update on PA invoice affects 0 rows');

with d as (
  delete from public.supply_invoices where id = '7a000000-0000-0000-0000-000000000002' returning id
)
select is((select count(*)::int from d), 0, 'B delete on PA invoice affects 0 rows');

-- ================= Viewer V в PA =================

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;

-- 18-20
select is((select count(*)::int from public.supply_requests), 2, 'viewer reads PA supply rows');

select throws_ok(
  $$ insert into public.supply_request_items (project_id, request_id, line_no, name, unit, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000001', 9, 'Дюбель', 'шт', 1) $$,
  '42501', null,
  'viewer cannot insert item'
);

with u as (
  update public.supply_invoices set paid_on = date '2026-10-20'
  where id = '7a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*)::int from u), 0, 'viewer update of invoice affects 0 rows');

-- ================= Member M в PA =================

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true) as _;

-- 21-22
select lives_ok(
  $$ insert into public.supply_request_items (project_id, request_id, line_no, name, unit, quantity, note)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '5a000000-0000-0000-0000-000000000001', 9, 'Дюбель NAT 6', 'шт', 500, 'каталог Лемана') $$,
  'member can insert item'
);

with u as (
  update public.supply_invoices set paid_on = date '2026-10-14'
  where id = '7a000000-0000-0000-0000-000000000001' returning id
)
select is((select count(*)::int from u), 1, 'member can mark invoice paid');

-- ================= Владелец A =================

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;

-- 23
select throws_ok(
  $$ update public.supply_requests set project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     where id = '5a000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'project_id is not updatable'
);

-- 24
select throws_ok(
  $$ insert into public.supply_invoice_lines (project_id, invoice_id, request_id, request_item_id, line_no, name, unit, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '7a000000-0000-0000-0000-000000000001',
             '5a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000002', 9, 'Саморез', 'упак', 1) $$,
  '23503', null,
  'invoice line cannot link to item of another request'
);

-- 25
select throws_ok(
  $$ insert into public.supply_delivery_lines (project_id, delivery_id, invoice_id, invoice_line_id, quantity)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '9a000000-0000-0000-0000-000000000001',
             '7a000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000002', 1) $$,
  '23503', null,
  'delivery line cannot reference line of another invoice'
);

-- ================= Оприходование: связь с журналом =================

reset role;

-- 26
select throws_ok(
  $$ insert into public.material_movements (project_id, material_id, kind, quantity, supply_delivery_line_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a1', 'adjustment', 1,
             'c1000000-0000-0000-0000-0000000000a1') $$,
  '23514', null,
  'receipt link requires kind receipt'
);

insert into public.material_movements (project_id, material_id, kind, quantity, supply_delivery_line_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a1', 'receipt', 18.2,
   'c1000000-0000-0000-0000-0000000000a1');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true) as _;
set role authenticated;

-- 27-30
select throws_ok(
  $$ delete from public.supply_delivery_lines where id = 'c1000000-0000-0000-0000-0000000000a1' $$,
  '23503', null,
  'received delivery line cannot be deleted'
);
select throws_ok(
  $$ delete from public.supply_deliveries where id = '9a000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'delivery with received line cannot be deleted'
);
select throws_ok(
  $$ delete from public.supply_invoices where id = '7a000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'invoice with received line cannot be deleted'
);
select throws_ok(
  $$ delete from public.supply_requests where id = '5a000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'request with received line cannot be deleted'
);

-- 31-32. Счёт без оприходования удаляется вместе со строками и поставками
with d as (
  delete from public.supply_invoices where id = '7a000000-0000-0000-0000-000000000002' returning id
)
select is((select count(*)::int from d), 1, 'invoice without receipts is deleted');
select is(
  (select count(*)::int from public.supply_delivery_lines where id = 'c1000000-0000-0000-0000-0000000000a2'),
  0,
  'delivery lines of deleted invoice are gone'
);

-- 33. Удаление позиции делает её строки счёта «вне заявки»
delete from public.supply_request_items where id = '6a000000-0000-0000-0000-000000000001';
select is(
  (select request_item_id from public.supply_invoice_lines where id = '8a000000-0000-0000-0000-000000000001'),
  null,
  'deleting item turns its invoice lines into off-request'
);

-- ================= RPC =================

-- 34-37
select ok(not has_function_privilege('anon', 'public.create_supply_request(uuid, text, date, text, jsonb)', 'execute'),
  'anon cannot execute create_supply_request');
select ok(not has_function_privilege('anon', 'public.create_supply_invoice(uuid, text, date, text, numeric, date, jsonb)', 'execute'),
  'anon cannot execute create_supply_invoice');
select ok(not has_function_privilege('anon', 'public.create_supply_delivery(uuid, text, date, jsonb)', 'execute'),
  'anon cannot execute create_supply_delivery');
select ok(not has_function_privilege('anon', 'public.receive_supply_delivery_line(uuid, uuid, numeric, text)', 'execute'),
  'anon cannot execute receive_supply_delivery_line');

-- 38-39. Заявка с позициями — одной транзакцией
-- Вызов и проверка — разными операторами: оператор не видит строк,
-- вставленных функцией в его же CTE (снимок берётся до вызова).
select set_config('test.request', public.create_supply_request(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ' 16 ', date '2026-10-20', 'Цех',
    '[{"line_no": 1, "name": "Подвес прямой", "unit": "шт", "quantity": 230},
      {"line_no": 2, "name": "Дюбель NAT 6", "unit": "шт", "quantity": 500, "note": "каталог Лемана"}]'::jsonb
  )::text, false) as _;
select is(
  (select count(*)::int from public.supply_request_items where request_id = current_setting('test.request')::uuid),
  2,
  'create_supply_request inserts request and 2 items'
);

select throws_ok(
  $$ select public.create_supply_request(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '17', date '2026-10-20', null,
       '[{"line_no": 1, "name": "Подвес", "unit": "шт", "quantity": 1},
         {"line_no": 2, "name": "Дюбель", "unit": "шт", "quantity": 0}]'::jsonb) $$,
  '23514', null,
  'create_supply_request is all-or-nothing'
);

-- 40. После ошибки заявки «17» нет
select is((select count(*)::int from public.supply_requests where number = '17'), 0, 'failed create_supply_request leaves no request');

-- 41-42. Счёт со строками
select set_config('test.invoice', public.create_supply_invoice(
    '5a000000-0000-0000-0000-000000000002', '89598', date '2026-10-08', 'ТД ЦСК', 1000, null,
    '[{"line_no": 3, "name": "Саморез по дереву 3,8х35 (1000шт)", "unit": "упак", "quantity": 1,
       "request_item_id": "6a000000-0000-0000-0000-000000000002"}]'::jsonb
  )::text, false) as _;
select is(
  (select request_item_id from public.supply_invoice_lines where invoice_id = current_setting('test.invoice')::uuid),
  '6a000000-0000-0000-0000-000000000002'::uuid,
  'create_supply_invoice links line to item'
);

select throws_ok(
  $$ select public.create_supply_invoice(
       '5a000000-0000-0000-0000-000000000001', '1', date '2026-10-08', 'ЦСК', null, null,
       '[{"line_no": 1, "name": "Саморез", "unit": "упак", "quantity": 1,
          "request_item_id": "6a000000-0000-0000-0000-000000000002"}]'::jsonb) $$,
  '23503', null,
  'create_supply_invoice rejects item of other request'
);

-- 43-44. Поставка
select throws_ok(
  $$ select public.create_supply_delivery(
       (select id from public.supply_invoices where request_id = '5a000000-0000-0000-0000-000000000002'),
       '84009', date '2026-10-16', '[]'::jsonb) $$,
  'P0001', 'supply_lines_empty',
  'create_supply_delivery with empty lines'
);

select set_config('test.delivery', public.create_supply_delivery(
    (select id from public.supply_invoices where request_id = '5a000000-0000-0000-0000-000000000002'),
    '84009', date '2026-10-16',
    jsonb_build_array(jsonb_build_object(
      'invoice_line_id',
      (select l.id from public.supply_invoice_lines l where l.request_id = '5a000000-0000-0000-0000-000000000002'),
      'quantity', 1))
  )::text, false) as _;
select is(
  (select count(*)::int from public.supply_delivery_lines where delivery_id = current_setting('test.delivery')::uuid),
  1,
  'create_supply_delivery inserts lines'
);

select set_config(
  'test.delivery_line',
  (select dl.id::text from public.supply_delivery_lines dl
   where dl.invoice_id = (select id from public.supply_invoices where request_id = '5a000000-0000-0000-0000-000000000002')),
  false
) as _;

-- 45-47. Оприходование
with m as (
  select public.receive_supply_delivery_line(
    current_setting('test.delivery_line')::uuid, 'd1000000-0000-0000-0000-0000000000a1', 3, null
  ) as mv
)
select is((select (mv).quantity from m), 3::numeric(14, 3), 'receive returns the receipt movement');

select is(
  (select current_balance from public.materials where id = 'd1000000-0000-0000-0000-0000000000a1'),
  3::numeric(14, 3),
  'receive: balance grows by p_quantity'
);

select is(
  (select kind::text || ' / ' || note from public.material_movements
   where supply_delivery_line_id = current_setting('test.delivery_line')::uuid),
  'receipt / УПД №84009 от 16.10.2026, счёт №89598',
  'receive: movement is receipt linked to line with default note'
);

-- 48-50
select throws_ok(
  $$ select public.receive_supply_delivery_line(current_setting('test.delivery_line')::uuid,
       'd1000000-0000-0000-0000-0000000000a1', 3, null) $$,
  'P0001', 'already_received',
  'receive twice'
);
select throws_ok(
  $$ select public.receive_supply_delivery_line(current_setting('test.delivery_line')::uuid,
       'd1000000-0000-0000-0000-0000000000b1', 3, null) $$,
  'P0001', 'material_not_found',
  'receive into material of other project'
);
select throws_ok(
  $$ select public.receive_supply_delivery_line(current_setting('test.delivery_line')::uuid,
       'd1000000-0000-0000-0000-0000000000a1', 0, null) $$,
  'P0001', 'invalid_quantity',
  'receive 0'
);

-- 50a. Количество оприходованной строки поставки не меняется; приход и документ не расходятся
select throws_ok(
  $$ update public.supply_delivery_lines set quantity = 5
     where id = current_setting('test.delivery_line')::uuid $$,
  'P0001', 'already_received',
  'received delivery line quantity cannot be changed'
);
-- 51. Viewer
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true) as _;
select throws_ok(
  $$ select public.receive_supply_delivery_line(current_setting('test.delivery_line')::uuid,
       'd1000000-0000-0000-0000-0000000000a1', 3, null) $$,
  'P0001', 'access_denied',
  'receive by viewer'
);

-- 52-53. Чужой владелец B
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
select throws_ok(
  $$ select public.receive_supply_delivery_line(current_setting('test.delivery_line')::uuid,
       'd1000000-0000-0000-0000-0000000000a1', 3, null) $$,
  'P0001', 'supply_line_not_found',
  'receive by B'
);
select throws_ok(
  $$ select public.create_supply_invoice(
       '5a000000-0000-0000-0000-000000000001', '1', date '2026-10-08', 'ЦСК', null, null, '[]'::jsonb) $$,
  'P0001', 'supply_parent_not_found',
  'create_supply_invoice on foreign request'
);

-- ================= Удаление проекта с оприходованной поставкой =================

reset role;

update public.projects set archived_at = now() where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

insert into public.material_movements (project_id, material_id, kind, quantity, supply_delivery_line_id) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1000000-0000-0000-0000-0000000000b1', 'receipt', 10,
   'c1000000-0000-0000-0000-0000000000b1');

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true) as _;
set role authenticated;

-- 54
with d as (
  delete from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id
)
select is((select count(*)::int from d), 1, 'owner deletes project with received supply');

select * from finish();

rollback;
