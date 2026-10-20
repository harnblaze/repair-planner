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
import type { SupplyItemView, SupplyRequestView } from "@/lib/types/supply";
import {
  supplyItemEditSchema,
  supplyItemsSchema,
  supplyRequestSchema,
  type SupplyItemEditFormValues,
  type SupplyItemEditInput,
  type SupplyRequestFormValues,
  type SupplyRequestInput,
} from "@/lib/validation/supply";

import {
  addSupplyItemsAction,
  createSupplyRequestAction,
  deleteSupplyItemAction,
  deleteSupplyRequestAction,
  setSupplyItemCancelledAction,
  updateSupplyItemAction,
  updateSupplyRequestAction,
} from "./actions";
import { PasteRows, rowIsValid, toRowInputs, type EditableRow } from "./paste-rows";
import { FieldError, SupplyDialog } from "./supply-dialog";
import type { SupplyMaterialOption } from "./supply-data";

interface DialogProps {
  projectId: string;
  onClose: () => void;
}

/** Проверка строк предпросмотра перед отправкой; null — показана ошибка. */
function checkedItems(rows: EditableRow[], after: number) {
  if (rows.some((r) => !rowIsValid(r))) {
    toast.error("Есть нераспознанные строки — исправьте или удалите их.");
    return null;
  }
  const parsed = supplyItemsSchema.safeParse(numberRows(toRowInputs(rows), after));
  if (!parsed.success) {
    toast.error("Проверьте строки: наименование, единицу и количество.");
    return null;
  }
  return parsed.data;
}

// ================= Заявка: создание и правка шапки =================

export function RequestDialog({
  projectId,
  today,
  request,
  onClose,
}: DialogProps & { today: string; request: SupplyRequestView | null }) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplyRequestFormValues, unknown, SupplyRequestInput>({
    resolver: zodResolver(supplyRequestSchema),
    defaultValues: {
      number: request?.number ?? "",
      requestDate: request?.requestDate ?? today,
      description: request?.description ?? "",
    },
  });

  const onSubmit = handleSubmit((data) => {
    const items = request ? [] : rows.length === 0 ? [] : checkedItems(rows, 0);
    if (items === null) return;
    startTransition(async () => {
      const result = request
        ? await updateSupplyRequestAction(projectId, request.id, data)
        : await createSupplyRequestAction(projectId, data, items);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(request ? "Заявка сохранена." : "Заявка на ТМЦ создана.");
      onClose();
    });
  });

  const onDelete = () => {
    if (!request || !window.confirm(`Удалить заявку №${request.number} со всеми счетами и поставками?`)) return;
    startTransition(async () => {
      const result = await deleteSupplyRequestAction(projectId, request.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Заявка удалена.");
      onClose();
    });
  };

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={request ? "Заявка на ТМЦ" : "Новая заявка на ТМЦ"} wide={!request}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[140px_160px_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-number">Номер</Label>
            <Input id="request-number" autoFocus aria-invalid={!!errors.number} {...register("number")} />
            <FieldError message={errors.number?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-date">Дата</Label>
            <Input id="request-date" type="date" aria-invalid={!!errors.requestDate} {...register("requestDate")} />
            <FieldError message={errors.requestDate?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-description">Описание (необязательно)</Label>
            <Input id="request-description" placeholder="Материалы на кабинет" {...register("description")} />
            <FieldError message={errors.description?.message} />
          </div>
        </div>

        {!request && <PasteRows mode="items" rows={rows} onChange={setRows} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {request ? (
            <Button type="button" variant="destructive" disabled={pending} onClick={onDelete}>
              Удалить заявку
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending}>
            {request ? "Сохранить" : rows.length > 0 ? `Создать с позициями: ${rows.length}` : "Создать заявку"}
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}

// ================= Позиции: добавление пачкой =================

export function ItemsDialog({ projectId, request, onClose }: DialogProps & { request: SupplyRequestView }) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const after = request.items.reduce((max, i) => Math.max(max, i.lineNo), 0);

  const onSave = () => {
    const items = checkedItems(rows, after);
    if (items === null) return;
    startTransition(async () => {
      const result = await addSupplyItemsAction(projectId, request.id, items);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Добавлено позиций: ${items.length}.`);
      onClose();
    });
  };

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Позиции заявки №${request.number}`} wide>
      <div className="flex flex-col gap-3">
        <PasteRows mode="items" rows={rows} onChange={setRows} />
        <div className="flex justify-end">
          <Button type="button" disabled={pending || rows.length === 0} onClick={onSave}>
            Добавить позиции{rows.length > 0 ? `: ${rows.length}` : ""}
          </Button>
        </div>
      </div>
    </SupplyDialog>
  );
}

// ================= Позиция: правка, «снята», удаление =================

export function ItemDialog({
  projectId,
  item,
  materials,
  onClose,
}: DialogProps & { item: SupplyItemView; materials: SupplyMaterialOption[] }) {
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplyItemEditFormValues, unknown, SupplyItemEditInput>({
    resolver: zodResolver(supplyItemEditSchema),
    defaultValues: {
      lineNo: item.lineNo,
      name: item.name,
      unit: item.unit,
      quantity: String(item.quantity).replace(".", ","),
      note: item.note ?? "",
      materialId: item.materialId,
    },
  });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Не удалось сохранить. Попробуйте ещё раз.");
        return;
      }
      toast.success(success);
      onClose();
    });

  const onSubmit = handleSubmit((data) => run(() => updateSupplyItemAction(projectId, item.id, data), "Позиция сохранена."));

  return (
    <SupplyDialog open onOpenChange={(o) => !o && onClose()} title={`Позиция №${item.lineNo}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-line">№</Label>
            <Input id="item-line" inputMode="numeric" aria-invalid={!!errors.lineNo} {...register("lineNo")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-name">Наименование</Label>
            <Input id="item-name" aria-invalid={!!errors.name} {...register("name")} />
            <FieldError message={errors.name?.message} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-unit">Ед.</Label>
            <Input id="item-unit" aria-invalid={!!errors.unit} {...register("unit")} />
            <FieldError message={errors.unit?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-quantity">Кол-во</Label>
            <Input id="item-quantity" inputMode="decimal" aria-invalid={!!errors.quantity} {...register("quantity")} />
            <FieldError message={errors.quantity?.message} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-note">Примечание</Label>
          <Input id="item-note" placeholder="каталог Лемана" {...register("note")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-material">Материал справочника (для оприходования)</Label>
          <NativeSelect id="item-material" {...register("materialId", { setValueAs: (v) => v || null })}>
            <option value="">— не выбран —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.unit})
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => setSupplyItemCancelledAction(projectId, item.id, !item.cancelled),
                  item.cancelled ? "Позиция возвращена." : "Позиция снята.",
                )
              }
            >
              {item.cancelled ? "Вернуть" : "Снять"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Удалить позицию? Строки счетов останутся «вне заявки».")) {
                  run(() => deleteSupplyItemAction(projectId, item.id), "Позиция удалена.");
                }
              }}
            >
              Удалить
            </Button>
          </div>
          <Button type="submit" disabled={pending}>
            Сохранить
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}
