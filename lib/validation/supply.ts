import { z } from "zod";

import { parseDecimal } from "@/lib/business/supply-paste";

import { MAX_QUANTITY } from "./reference-data";

// Снабжение (docs/superpowers/specs/2026-10-20-supply-tracking-design.md).
// Пары типов, как в reference-data.ts: XInput — выход схемы (для server
// action), XFormValues — вход (для useForm).

const idSchema = z.guid();

// Мастер вводит «5,2» и «1 500», как в документах: z.coerce не понимает
// запятую и пробел. Пустая строка → undefined → «Введите число».
export const decimalNumber = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    if (value.trim() === "") return undefined;
    return parseDecimal(value) ?? Number.NaN;
  }, z.number({ error: "Введите число" }));

export const positiveQuantity = decimalNumber().pipe(
  z.number().gt(0, "Количество должно быть больше нуля").max(MAX_QUANTITY, "Слишком большое число"),
);

const isoDate = z.iso.date({ error: "Укажите дату" });

const text = (max: number, empty: string) =>
  z.string().trim().min(1, empty).max(max, "Слишком длинно");

const optionalText = (max: number) => z.string().trim().max(max, "Слишком длинно").optional();

// ================= Заявка и позиции =================

export const supplyRequestSchema = z.object({
  number: text(60, "Введите номер заявки"),
  requestDate: isoDate,
  description: optionalText(500),
});

export type SupplyRequestInput = z.output<typeof supplyRequestSchema>;
export type SupplyRequestFormValues = z.input<typeof supplyRequestSchema>;

export const supplyItemSchema = z.object({
  lineNo: z.coerce.number().int().min(1, "№ от 1").max(99_999, "Слишком большой №"),
  name: text(300, "Введите наименование"),
  unit: text(30, "Укажите единицу"),
  quantity: positiveQuantity,
  note: optionalText(300),
});

export type SupplyItemInput = z.output<typeof supplyItemSchema>;
export type SupplyItemFormValues = z.input<typeof supplyItemSchema>;

export const supplyItemEditSchema = supplyItemSchema.extend({
  materialId: idSchema.nullable(),
});

export type SupplyItemEditInput = z.output<typeof supplyItemEditSchema>;
export type SupplyItemEditFormValues = z.input<typeof supplyItemEditSchema>;

export const supplyItemsSchema = z.array(supplyItemSchema).min(1, "Добавьте хотя бы одну строку").max(500);

// ================= Счёт и строки =================

export const supplyInvoiceSchema = z.object({
  number: text(60, "Введите номер счёта"),
  invoiceDate: isoDate,
  supplier: text(200, "Укажите поставщика"),
  amount: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    decimalNumber().pipe(z.number().min(0, "Не может быть отрицательной").max(MAX_QUANTITY, "Слишком большое число")).nullable(),
  ),
  paidOn: isoDate.nullable(),
});

export type SupplyInvoiceInput = z.output<typeof supplyInvoiceSchema>;
export type SupplyInvoiceFormValues = z.input<typeof supplyInvoiceSchema>;

export const supplyInvoiceLineSchema = z.object({
  lineNo: supplyItemSchema.shape.lineNo,
  name: text(300, "Введите наименование"),
  unit: text(30, "Укажите единицу"),
  quantity: positiveQuantity,
  requestItemId: idSchema.nullable(),
});

export type SupplyInvoiceLineInput = z.output<typeof supplyInvoiceLineSchema>;
export type SupplyInvoiceLineFormValues = z.input<typeof supplyInvoiceLineSchema>;

export const supplyInvoiceLinesSchema = z
  .array(supplyInvoiceLineSchema)
  .min(1, "Добавьте хотя бы одну строку")
  .max(500);

// ================= Поставка и оприходование =================

export const supplyDeliverySchema = z.object({
  number: text(60, "Введите номер УПД"),
  deliveryDate: isoDate,
  lines: z
    .array(z.object({ invoiceLineId: idSchema, quantity: positiveQuantity }))
    .min(1, "Отметьте хотя бы одну строку"),
});

export type SupplyDeliveryInput = z.output<typeof supplyDeliverySchema>;
export type SupplyDeliveryFormValues = z.input<typeof supplyDeliverySchema>;

export const supplyReceiveSchema = z.object({
  materialId: idSchema.or(z.literal("")).refine((v) => v !== "", "Выберите материал"),
  quantity: positiveQuantity,
  note: optionalText(500),
});

export type SupplyReceiveInput = z.output<typeof supplyReceiveSchema>;
export type SupplyReceiveFormValues = z.input<typeof supplyReceiveSchema>;
