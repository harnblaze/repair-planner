"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateShort } from "@/lib/business/dates";
import { unitsMatch } from "@/lib/business/supply-match";
import { parseDecimal } from "@/lib/business/supply-paste";
import { lineProgress, remainingToDeliver } from "@/lib/business/supply-status";
import type {
  SupplyDeliveryLineView,
  SupplyDeliveryView,
  SupplyInvoiceLineView,
  SupplyRequestView,
} from "@/lib/types/supply";
import {
  supplyDeliverySchema,
  supplyReceiveSchema,
  type SupplyReceiveFormValues,
  type SupplyReceiveInput,
} from "@/lib/validation/supply";

import {
  createSupplyDeliveryAction,
  createSupplyMaterialAction,
  deleteSupplyDeliveryLineAction,
  receiveSupplyDeliveryLineAction,
  updateSupplyDeliveryLineAction,
} from "./actions";
import { formatDocDate, formatQuantity } from "./format";
import { FieldError, SupplyDialog } from "./supply-dialog";
import type { SupplyMaterialOption } from "./supply-data";

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

const asInput = (value: number) => (value > 0 ? formatQuantity(value).replace(/\s/g, "") : "");

// ================= Поставка: выбор счёта, № УПД, сколько привезли =================

export function DeliveryDialog({
  projectId,
  request,
  today,
  onClose,
}: DialogProps & { request: SupplyRequestView; today: string }) {
  const { pending, run } = useRun(onClose);
  // По умолчанию — первый счёт, по которому ещё что-то ждём.
  const initial =
    request.invoices.find((inv) => inv.lines.some((l) => remainingToDeliver(l) > 0)) ?? request.invoices[0];
  const [invoiceId, setInvoiceId] = useState(initial?.id ?? "");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const invoice = request.invoices.find((i) => i.id === invoiceId);
  const remainingInputs = (lines: SupplyInvoiceLineView[]) =>
    Object.fromEntries(lines.map((l) => [l.id, asInput(remainingToDeliver(l))]));
  const [quantities, setQuantities] = useState<Record<string, string>>(() => remainingInputs(initial?.lines ?? []));
  const itemName = new Map(request.items.map((i) => [i.id, `${i.lineNo}. ${i.name}`]));

  const onSubmit = () => {
    if (!invoice) return;
    const lines = invoice.lines
      .map((l) => ({ invoiceLineId: l.id, quantity: quantities[l.id] ?? "" }))
      .filter((l) => (parseDecimal(l.quantity) ?? 0) > 0);
    const parsed = supplyDeliverySchema.safeParse({ number, deliveryDate: date, lines });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте поля поставки.");
      return;
    }
    run(() => createSupplyDeliveryAction(projectId, invoice.id, parsed.data), "Поставка записана.");
  };

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Поставка по заявке №${request.number}`} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delivery-invoice">Счёт</Label>
            <NativeSelect
              id="delivery-invoice"
              value={invoiceId}
              onChange={(e) => {
                setInvoiceId(e.target.value);
                setQuantities(remainingInputs(request.invoices.find((i) => i.id === e.target.value)?.lines ?? []));
              }}
            >
              {request.invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  №{inv.number} от {formatDateShort(inv.invoiceDate)} · {inv.supplier}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delivery-number">№ УПД</Label>
            <Input id="delivery-number" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delivery-date">Дата</Label>
            <Input id="delivery-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {invoice && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-ink-header">
                  <th className="px-1 py-1">По счёту</th>
                  <th className="px-1 py-1">Позиция заявки</th>
                  <th className="px-1 py-1 text-right">В счёте</th>
                  <th className="px-1 py-1 text-right">Уже привезли</th>
                  <th className="w-28 px-1 py-1">Привезено сейчас</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => {
                  const already = lineProgress(line).delivered;
                  return (
                    <tr key={line.id} className="border-t border-line-subtle">
                      <td className="px-1 py-1">{line.name}</td>
                      <td className="px-1 py-1 text-meta">
                        {line.requestItemId ? itemName.get(line.requestItemId) : "вне заявки"}
                      </td>
                      <td className="px-1 py-1 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.quantity)} {line.unit}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums">
                        {already > 0 ? formatQuantity(already) : "—"}
                      </td>
                      <td className="px-1 py-0.5">
                        <input
                          aria-label={`Привезено: ${line.name}`}
                          inputMode="decimal"
                          className="h-7 w-full rounded-[6px] border border-control bg-surface px-2 text-[12px] outline-none focus-visible:border-brand"
                          value={quantities[line.id] ?? ""}
                          onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="pt-1 text-[11px] text-meta">Пустое поле или 0 — строка в эту поставку не вошла.</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !invoice}>
            Записать поставку
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}

// ================= Строка поставки: правка количества и удаление =================

export function DeliveryLineDialog({
  projectId,
  line,
  deliveryLine,
  delivery,
  onClose,
}: DialogProps & { line: SupplyInvoiceLineView; deliveryLine: SupplyDeliveryLineView; delivery: SupplyDeliveryView }) {
  const { pending, run } = useRun(onClose);
  const [quantity, setQuantity] = useState(asInput(deliveryLine.quantity));

  return (
    <SupplyDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`УПД №${delivery.number} от ${formatDocDate(delivery.deliveryDate)}`}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateSupplyDeliveryLineAction(projectId, deliveryLine.id, quantity), "Поставка сохранена.");
        }}
      >
        <p className="text-[12.5px] text-ink-soft">{line.name}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delivery-line-quantity">Привезено, {line.unit}</Label>
          <Input
            id="delivery-line-quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Удалить эту строку из поставки?")) {
                run(() => deleteSupplyDeliveryLineAction(projectId, deliveryLine.id), "Строка поставки удалена.");
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

// ================= Оприходование на остаток =================

export function ReceiveDialog({
  projectId,
  line,
  deliveryLine,
  delivery,
  defaultMaterialId,
  materials,
  onClose,
}: DialogProps & {
  line: SupplyInvoiceLineView;
  deliveryLine: SupplyDeliveryLineView;
  delivery: SupplyDeliveryView;
  defaultMaterialId: string | null;
  materials: SupplyMaterialOption[];
}) {
  const { pending, run } = useRun(onClose);
  const [created, setCreated] = useState<SupplyMaterialOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(line.name);
  const [newUnit, setNewUnit] = useState(line.unit);
  const [creatingPending, startCreating] = useTransition();
  const options = [...materials, ...created.filter((c) => !materials.some((m) => m.id === c.id))];

  // Кол-во по умолчанию — привезённое, если единица та же (иначе пересчёт за мастером).
  const defaultQuantity = (materialId: string | null) => {
    const material = options.find((m) => m.id === materialId);
    return material && unitsMatch(material.unit, line.unit) ? asInput(deliveryLine.quantity) : "";
  };

  const initialMaterial = defaultMaterialId && options.some((m) => m.id === defaultMaterialId) ? defaultMaterialId : "";
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<SupplyReceiveFormValues, unknown, SupplyReceiveInput>({
    resolver: zodResolver(supplyReceiveSchema),
    defaultValues: { materialId: initialMaterial, quantity: defaultQuantity(initialMaterial || null), note: "" },
  });
  const materialId = useWatch({ control, name: "materialId" });
  const material = options.find((m) => m.id === materialId);

  const materialField = register("materialId");

  const onCreate = () =>
    startCreating(async () => {
      const result = await createSupplyMaterialAction(projectId, { name: newName, unit: newUnit });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const option = { id: result.materialId, name: newName.trim(), unit: newUnit.trim() };
      setCreated((c) => [...c, option]);
      setCreating(false);
      setValue("materialId", option.id);
      setValue("quantity", unitsMatch(option.unit, line.unit) ? asInput(deliveryLine.quantity) : "");
      toast.success("Материал добавлен в справочник.");
    });

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title="Оприходовать на остаток">
      <form
        className="flex flex-col gap-3"
        onSubmit={handleSubmit((data) =>
          run(() => receiveSupplyDeliveryLineAction(projectId, deliveryLine.id, data), "Приход записан в «Материалы»."),
        )}
      >
        <p className="text-[12px] text-ink-soft">
          {line.name} — привезено {formatQuantity(deliveryLine.quantity)} {line.unit} (УПД №{delivery.number} от{" "}
          {formatDocDate(delivery.deliveryDate)})
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receive-material">Материал справочника</Label>
          <NativeSelect
            id="receive-material"
            aria-invalid={!!errors.materialId}
            {...materialField}
            // Управляемое значение: новый материал выбирается после того, как его
            // <option> появится в списке (setValue раньше рендера DOM не выберет).
            value={materialId ?? ""}
            onChange={(e) => {
              void materialField.onChange(e);
              setValue("quantity", defaultQuantity(e.target.value || null));
            }}
          >
            <option value="">— выберите —</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.unit})
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.materialId?.message} />
          {!creating ? (
            <button
              type="button"
              className="self-start text-[11.5px] font-medium text-brand hover:underline"
              onClick={() => setCreating(true)}
            >
              Создать материал
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-[7px] bg-page p-2">
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Input aria-label="Название нового материала" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input aria-label="Единица нового материала" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={creatingPending} onClick={onCreate}>
                  Добавить в справочник
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receive-quantity">
            Количество{material ? ` в единицах материала: ${material.unit}` : ""}
          </Label>
          <Input id="receive-quantity" inputMode="decimal" aria-invalid={!!errors.quantity} {...register("quantity")} />
          <FieldError message={errors.quantity?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receive-note">Комментарий (необязательно)</Label>
          <Input id="receive-note" placeholder={`УПД №${delivery.number}…`} {...register("note")} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            Оприходовать
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}
