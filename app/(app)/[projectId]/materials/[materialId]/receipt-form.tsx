"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  materialReceiptSchema,
  type MaterialReceiptFormValues,
  type MaterialReceiptInput,
} from "@/lib/validation/reference-data";

import { recordMaterialReceiptAction } from "../actions";

/**
 * Приход материала. На странице материала — с подписями полей; в строке списка
 * материалов (compact) — одной строкой, с кнопкой отмены.
 */
export function ReceiptForm({
  projectId,
  materialId,
  unit,
  compact = false,
  onDone,
}: {
  projectId: string;
  materialId: string;
  unit: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const idPrefix = `receipt-${materialId}`;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MaterialReceiptFormValues, unknown, MaterialReceiptInput>({
    resolver: zodResolver(materialReceiptSchema),
    defaultValues: { quantity: "", note: "" },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await recordMaterialReceiptAction(projectId, materialId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Приход записан.");
        reset();
        onDone?.();
      }
    });
  });

  const errorText = (message?: string) =>
    message ? <p className="text-[11.5px] text-status-alert-fg">{message}</p> : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2" noValidate>
      <div className="flex w-32 flex-col gap-1">
        <Label htmlFor={`${idPrefix}-quantity`} className={compact ? "sr-only" : undefined}>
          Количество, {unit}
        </Label>
        <Input
          id={`${idPrefix}-quantity`}
          type="number"
          step="0.001"
          min="0"
          placeholder={compact ? `Приход, ${unit}` : undefined}
          autoFocus={compact}
          {...register("quantity")}
        />
        {errorText(errors.quantity?.message)}
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <Label htmlFor={`${idPrefix}-note`} className={compact ? "sr-only" : undefined}>
          Комментарий
        </Label>
        <Input
          id={`${idPrefix}-note`}
          placeholder="Например, накладная № 15"
          {...register("note")}
        />
        {errorText(errors.note?.message)}
      </div>
      <div className={compact ? "flex gap-2" : "flex w-full gap-2"}>
        <Button type="submit" size={compact ? "sm" : "default"} disabled={pending}>
          {pending ? "Запись…" : "Записать приход"}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" size={compact ? "sm" : "default"} onClick={onDone}>
            Отмена
          </Button>
        ) : null}
      </div>
    </form>
  );
}
