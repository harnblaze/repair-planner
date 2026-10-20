// Представление данных снабжения для страницы «Снабжение»
// (docs/superpowers/specs/2026-10-20-supply-tracking-design.md §4).
// Количества — числа (numeric из PostgREST), даты документов — "YYYY-MM-DD".

export interface SupplyItemView {
  id: string;
  lineNo: number;
  name: string;
  unit: string;
  quantity: number;
  note: string | null;
  materialId: string | null;
  cancelled: boolean;
}

export interface SupplyDeliveryLineView {
  id: string;
  deliveryId: string;
  quantity: number;
  received: boolean;
}

export interface SupplyInvoiceLineView {
  id: string;
  invoiceId: string;
  requestItemId: string | null;
  lineNo: number;
  name: string;
  unit: string;
  quantity: number;
  deliveries: SupplyDeliveryLineView[];
}

export interface SupplyInvoiceView {
  id: string;
  number: string;
  invoiceDate: string;
  supplier: string;
  amount: number | null;
  paidOn: string | null;
  lines: SupplyInvoiceLineView[];
}

export interface SupplyDeliveryView {
  id: string;
  invoiceId: string;
  number: string;
  deliveryDate: string;
}

export interface SupplyRequestView {
  id: string;
  number: string;
  requestDate: string;
  description: string | null;
  items: SupplyItemView[];
  invoices: SupplyInvoiceView[];
  deliveries: SupplyDeliveryView[];
}
