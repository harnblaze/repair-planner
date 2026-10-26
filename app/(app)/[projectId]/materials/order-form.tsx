"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  materialOrderSchema,
  type MaterialOrderFormValues,
  type MaterialOrderInput,
} from "@/lib/validation/reference-data";

import { addMaterialToOrderAction } from "./actions";

/**
 * «В заказ» в строке списка материалов: количество, которое попадёт пунктом
 * в список «Материалы к заказу». Одной строкой, как компактный «Приход».
 */
export function OrderForm({
  projectId,
  materialId,
  unit,
  suggested,
  onDone,
}: {
  projectId: string;
  materialId: string;
  unit: string;
  /** Сколько не хватает до минимума; null — поле пустое. */
  suggested: number | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<MaterialOrderFormValues, unknown, MaterialOrderInput>({
    resolver: zodResolver(materialOrderSchema),
    defaultValues: { quantity: suggested ?? "" },
  });

  // Подсказка «до минимума» выделена: набранное число заменяет её, а не дописывается
  // к ней. autoFocus для этого не годится — фокус приходит раньше, чем onFocus.
  useEffect(() => {
    setFocus("quantity", { shouldSelect: true });
  }, [setFocus]);

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await addMaterialToOrderAction(projectId, materialId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Добавлено в «Материалы к заказу».");
        onDone();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2" noValidate>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step="0.001"
            min="0"
            aria-label="Количество к заказу"
            className="w-32"
            {...register("quantity")}
          />
          <span className="text-[12px] text-meta">{unit}</span>
        </div>
        {errors.quantity?.message ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.quantity.message}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Добавление…" : "Добавить в заказ"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
