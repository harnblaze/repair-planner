"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMaterialSchema,
  type CreateMaterialFormValues,
  type CreateMaterialInput,
} from "@/lib/validation/reference-data";

import { createMaterialAction } from "./actions";

/** Форма открывается кнопкой «+ Материал»; после добавления остаётся открытой, чтобы завести несколько подряд. */
export function CreateMaterialForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<CreateMaterialFormValues, unknown, CreateMaterialInput>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: { name: "", unit: "", minimumBalance: 0, initialQuantity: 0 },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createMaterialAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Материал добавлен.");
        // Фокус до reset(): reset() снимает регистрацию полей до следующей отрисовки,
        // и setFocus после него не находит поле.
        setFocus("name");
        reset();
      }
    });
  });

  const label = "text-[11px] font-medium text-meta";
  const error = (message?: string) =>
    message ? <p className="text-[11.5px] text-status-alert-fg">{message}</p> : null;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-start gap-2 rounded-[8px] border border-line-subtle bg-surface-today p-3"
      noValidate
    >
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <Label htmlFor="material-name" className={label}>
          Название
        </Label>
        <Input id="material-name" placeholder="Например, электрод МР-3" autoFocus {...register("name")} />
        {error(errors.name?.message)}
      </div>
      <div className="flex w-20 flex-col gap-1">
        <Label htmlFor="material-unit" className={label}>
          Ед.
        </Label>
        <Input id="material-unit" placeholder="кг, шт" {...register("unit")} />
        {error(errors.unit?.message)}
      </div>
      <div className="flex w-24 flex-col gap-1">
        <Label htmlFor="material-initial-quantity" className={label} title="Начальный остаток">
          Нач. остаток
        </Label>
        <Input id="material-initial-quantity" type="number" step="0.001" {...register("initialQuantity")} />
        {error(errors.initialQuantity?.message)}
      </div>
      <div className="flex w-24 flex-col gap-1">
        <Label htmlFor="material-minimum-balance" className={label}>
          Мин. остаток
        </Label>
        <Input id="material-minimum-balance" type="number" step="0.001" {...register("minimumBalance")} />
        {error(errors.minimumBalance?.message)}
      </div>
      {/* Отступ сверху выравнивает кнопки по полям, а не по подписям. */}
      <div className="flex gap-2 pt-[15px]">
        <Button type="submit" disabled={pending}>
          {pending ? "Добавление…" : "Добавить"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </form>
  );
}
