import { createClient } from "@/lib/supabase/server";
import type { SupplyRequestView } from "@/lib/types/supply";

// Всё снабжение проекта одним вложенным запросом: заявок десятки в год
// (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §3 п.9).
// Подсказки !<FK> обязательны: строки счёта и поставки ссылаются сразу на
// несколько родителей, и PostgREST видит между таблицами больше одной связи.
const SUPPLY_SELECT = `
  id, number, request_date, description, created_at,
  supply_request_items!supply_request_items_request_fk (
    id, line_no, name, unit, quantity, note, material_id, cancelled_at
  ),
  supply_invoices!supply_invoices_request_fk (
    id, number, invoice_date, supplier, amount, paid_on, created_at,
    supply_invoice_lines!supply_invoice_lines_invoice_fk (
      id, request_item_id, line_no, name, unit, quantity,
      supply_delivery_lines!supply_delivery_lines_invoice_line_fk (
        id, delivery_id, quantity,
        material_movements!material_movements_supply_line_fk ( id )
      )
    ),
    supply_deliveries!supply_deliveries_invoice_fk ( id, number, delivery_date, created_at )
  )
`;

const byKey = <T>(key: (x: T) => string | number) => (a: T, b: T) => {
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/** null — запрос не удался (детали в логе сервера). */
export async function loadSupplyRequests(projectId: string): Promise<SupplyRequestView[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supply_requests")
    .select(SUPPLY_SELECT)
    .eq("project_id", projectId)
    .order("request_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadSupplyRequests:", error);
    return null;
  }

  return data.map((r) => {
    const invoices = [...r.supply_invoices].sort(byKey((i) => `${i.invoice_date} ${i.created_at}`));
    return {
      id: r.id,
      number: r.number,
      requestDate: r.request_date,
      description: r.description,
      items: r.supply_request_items
        .map((i) => ({
          id: i.id,
          lineNo: i.line_no,
          name: i.name,
          unit: i.unit,
          quantity: Number(i.quantity),
          note: i.note,
          materialId: i.material_id,
          cancelled: i.cancelled_at !== null,
        }))
        .sort(byKey((i) => i.lineNo)),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        invoiceDate: inv.invoice_date,
        supplier: inv.supplier,
        amount: inv.amount === null ? null : Number(inv.amount),
        paidOn: inv.paid_on,
        lines: inv.supply_invoice_lines
          .map((l) => ({
            id: l.id,
            invoiceId: inv.id,
            requestItemId: l.request_item_id,
            lineNo: l.line_no,
            name: l.name,
            unit: l.unit,
            quantity: Number(l.quantity),
            deliveries: l.supply_delivery_lines.map((dl) => ({
              id: dl.id,
              deliveryId: dl.delivery_id,
              quantity: Number(dl.quantity),
              received: dl.material_movements.length > 0,
            })),
          }))
          .sort(byKey((l) => l.lineNo)),
      })),
      deliveries: invoices
        .flatMap((inv) => inv.supply_deliveries.map((d) => ({ ...d, invoice_id: inv.id })))
        .sort(byKey((d) => `${d.delivery_date} ${d.created_at}`))
        .map((d) => ({ id: d.id, invoiceId: d.invoice_id, number: d.number, deliveryDate: d.delivery_date })),
    };
  });
}

export interface SupplyMaterialOption {
  id: string;
  name: string;
  unit: string;
}

/** Активные материалы справочника — для оприходования и подсказки у позиции. */
export async function loadSupplyMaterials(projectId: string): Promise<SupplyMaterialOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("id, name, unit")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("loadSupplyMaterials:", error);
    return [];
  }
  return data;
}
