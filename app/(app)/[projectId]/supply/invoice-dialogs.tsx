"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { numberRows } from "@/lib/business/supply-paste";
import type { SupplyInvoiceLineView, SupplyInvoiceView, SupplyRequestView } from "@/lib/types/supply";
import {
  supplyInvoiceLineSchema,
  supplyInvoiceLinesSchema,
  supplyInvoiceSchema,
  type SupplyInvoiceFormValues,
  type SupplyInvoiceInput,
  type SupplyInvoiceLineFormValues,
  type SupplyInvoiceLineInput,
} from "@/lib/validation/supply";

import {
  addSupplyInvoiceLinesAction,
  createSupplyInvoiceAction,
  deleteSupplyInvoiceAction,
  deleteSupplyInvoiceLineAction,
  setSupplyInvoicePaidAction,
  updateSupplyInvoiceAction,
  updateSupplyInvoiceLineAction,
} from "./actions";
import { PasteRows, rowIsValid, toRowInputs, type EditableRow } from "./paste-rows";
import { FieldError, SupplyDialog } from "./supply-dialog";

interface DialogProps {
  projectId: string;
  onClose: () => void;
}

type Result = { ok: true } | { ok: false; error: string };

function useRun(onClose: () => void) {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      onClose();
    });
  return { pending, run };
}

function checkedLines(rows: EditableRow[], after: number) {
  if (rows.some((r) => !rowIsValid(r))) {
    toast.error("Есть нераспознанные строки — исправьте или удалите их.");
    return null;
  }
  const parsed = supplyInvoiceLinesSchema.safeParse(numberRows(toRowInputs(rows), after));
  if (!parsed.success) {
    toast.error("Проверьте строки: наименование, единицу и количество.");
    return null;
  }
  return parsed.data;
}

const maxLineNo = (invoice: SupplyInvoiceView | null) =>
  invoice ? invoice.lines.reduce((max, l) => Math.max(max, l.lineNo), 0) : 0;

// ================= Счёт: создание со строками, правка шапки =================

export function InvoiceDialog({
  projectId,
  request,
  invoice,
  onClose,
}: DialogProps & { request: SupplyRequestView; invoice: SupplyInvoiceView | null }) {
  const { pending, run } = useRun(onClose);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplyInvoiceFormValues, unknown, SupplyInvoiceInput>({
    resolver: zodResolver(supplyInvoiceSchema),
    defaultValues: {
      number: invoice?.number ?? "",
      invoiceDate: invoice?.invoiceDate ?? "",
      supplier: invoice?.supplier ?? "",
      amount: invoice?.amount === null || invoice?.amount === undefined ? "" : String(invoice.amount).replace(".", ","),
      paidOn: invoice?.paidOn ?? null,
    },
  });

  const onSubmit = handleSubmit((data) => {
    if (invoice) {
      run(() => updateSupplyInvoiceAction(projectId, invoice.id, data), "Счёт сохранён.");
      return;
    }
    const lines = rows.length === 0 ? [] : checkedLines(rows, 0);
    if (lines === null) return;
    run(() => createSupplyInvoiceAction(projectId, request.id, data, lines), "Счёт добавлен.");
  });

  return (
    <SupplyDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={invoice ? `Счёт №${invoice.number}` : `Новый счёт к заявке №${request.number}`}
      wide={!invoice}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-number">Номер счёта</Label>
            <Input id="invoice-number" autoFocus aria-invalid={!!errors.number} {...register("number")} />
            <FieldError message={errors.number?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-date">Дата счёта</Label>
            <Input id="invoice-date" type="date" aria-invalid={!!errors.invoiceDate} {...register("invoiceDate")} />
            <FieldError message={errors.invoiceDate?.message} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-supplier">Поставщик</Label>
            <Input id="invoice-supplier" aria-invalid={!!errors.supplier} {...register("supplier")} />
            <FieldError message={errors.supplier?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-amount">Сумма, ₽</Label>
            <Input id="invoice-amount" inputMode="decimal" aria-invalid={!!errors.amount} {...register("amount")} />
            <FieldError message={errors.amount?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-paid">Оплачен</Label>
            <Input
              id="invoice-paid"
              type="date"
              aria-invalid={!!errors.paidOn}
              {...register("paidOn", { setValueAs: (v) => v || null })}
            />
            <p className="text-[11px] text-meta">Пусто — не оплачен</p>
          </div>
        </div>

        {!invoice && <PasteRows mode="invoice" requestItems={request.items} rows={rows} onChange={setRows} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {invoice ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Удалить счёт №${invoice.number} со строками и поставками?`)) {
                  run(() => deleteSupplyInvoiceAction(projectId, invoice.id), "Счёт удалён.");
                }
              }}
            >
              Удалить счёт
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending}>
            {invoice ? "Сохранить" : rows.length > 0 ? `Добавить со строками: ${rows.length}` : "Добавить счёт"}
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}

// ================= Строки в существующий счёт =================

export function InvoiceLinesDialog({
  projectId,
  request,
  invoice,
  onClose,
}: DialogProps & { request: SupplyRequestView; invoice: SupplyInvoiceView }) {
  const { pending, run } = useRun(onClose);
  const [rows, setRows] = useState<EditableRow[]>([]);

  const onSave = () => {
    const lines = checkedLines(rows, maxLineNo(invoice));
    if (lines === null) return;
    run(
      () => addSupplyInvoiceLinesAction(projectId, request.id, invoice.id, lines),
      `Добавлено строк: ${lines.length}.`,
    );
  };

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Строки счёта №${invoice.number}`} wide>
      <div className="flex flex-col gap-3">
        <PasteRows mode="invoice" requestItems={request.items} rows={rows} onChange={setRows} />
        <div className="flex justify-end">
          <Button type="button" disabled={pending || rows.length === 0} onClick={onSave}>
            Добавить строки{rows.length > 0 ? `: ${rows.length}` : ""}
          </Button>
        </div>
      </div>
    </SupplyDialog>
  );
}

// ================= Отметка оплаты =================

export function PaidDialog({
  projectId,
  invoice,
  today,
  onClose,
}: DialogProps & { invoice: SupplyInvoiceView; today: string }) {
  const { pending, run } = useRun(onClose);
  const [date, setDate] = useState(invoice.paidOn ?? today);

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Оплата счёта №${invoice.number}`}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setSupplyInvoicePaidAction(projectId, invoice.id, date), "Оплата отмечена.");
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paid-date">Дата оплаты</Label>
          <Input id="paid-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          {invoice.paidOn ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => setSupplyInvoicePaidAction(projectId, invoice.id, null), "Оплата снята.")}
            >
              Снять оплату
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending || date === ""}>
            Оплачен
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}

// ================= Строка счёта: правка и привязка =================

export function InvoiceLineDialog({
  projectId,
  request,
  line,
  onClose,
}: DialogProps & { request: SupplyRequestView; line: SupplyInvoiceLineView }) {
  const { pending, run } = useRun(onClose);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplyInvoiceLineFormValues, unknown, SupplyInvoiceLineInput>({
    resolver: zodResolver(supplyInvoiceLineSchema),
    defaultValues: {
      lineNo: line.lineNo,
      name: line.name,
      unit: line.unit,
      quantity: String(line.quantity).replace(".", ","),
      requestItemId: line.requestItemId,
    },
  });
  const choosable = request.items.filter((i) => !i.cancelled || i.id === line.requestItemId);

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Строка счёта №${line.lineNo}`}>
      <form
        onSubmit={handleSubmit((data) =>
          run(() => updateSupplyInvoiceLineAction(projectId, line.id, data), "Строка сохранена."),
        )}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-no">№</Label>
            <Input id="line-no" inputMode="numeric" {...register("lineNo")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-name">Наименование по счёту</Label>
            <Input id="line-name" aria-invalid={!!errors.name} {...register("name")} />
            <FieldError message={errors.name?.message} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-unit">Ед.</Label>
            <Input id="line-unit" aria-invalid={!!errors.unit} {...register("unit")} />
            <FieldError message={errors.unit?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-quantity">Кол-во</Label>
            <Input id="line-quantity" inputMode="decimal" aria-invalid={!!errors.quantity} {...register("quantity")} />
            <FieldError message={errors.quantity?.message} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line-item">Позиция заявки</Label>
          <NativeSelect id="line-item" {...register("requestItemId", { setValueAs: (v) => v || null })}>
            <option value="">— вне заявки —</option>
            {choosable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.lineNo}. {item.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Удалить строку счёта вместе с её поставками?")) {
                run(() => deleteSupplyInvoiceLineAction(projectId, line.id), "Строка удалена.");
              }
            }}
          >
            Удалить
          </Button>
          <Button type="submit" disabled={pending}>
            Сохранить
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}
