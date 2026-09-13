"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatQuantity } from "@/lib/business/material-report";
import {
  materialCountSchema,
  type MaterialCountFormValues,
  type MaterialCountInput,
} from "@/lib/validation/reference-data";

import { setMaterialBalanceAction } from "../actions";

/**
 * Корректировка по пересчёту: мастер вводит, сколько материала есть на самом
 * деле. Разницу с учётом считает база (set_material_balance), а не форма —
 * иначе одновременное списание из заявки потерялось бы.
 */
export function CountForm({
  projectId,
  materialId,
  unit,
  currentBalance,
}: {
  projectId: string;
  materialId: string;
  unit: string;
  currentBalance: number;
}) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MaterialCountFormValues, unknown, MaterialCountInput>({
    resolver: zodResolver(materialCountSchema),
    defaultValues: { actualBalance: "", note: "" },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await setMaterialBalanceAction(projectId, materialId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Остаток скорректирован.");
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2" noValidate>
      <div className="flex w-32 flex-col gap-1">
        <Label htmlFor="count-actual-balance">Фактически, {unit}</Label>
        <Input id="count-actual-balance" type="number" step="0.001" min="0" {...register("actualBalance")} />
        {errors.actualBalance ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.actualBalance.message}</p>
        ) : null}
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <Label htmlFor="count-note">Комментарий</Label>
        <Input id="count-note" placeholder="Например, инвентаризация" {...register("note")} />
        {errors.note ? <p className="text-[11.5px] text-status-alert-fg">{errors.note.message}</p> : null}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Запись…" : "Скорректировать"}
        </Button>
        <span className="text-[11.5px] text-meta">
          Сейчас в учёте: {formatQuantity(currentBalance)} {unit}
        </span>
      </div>
    </form>
  );
}
