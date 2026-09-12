"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMaterialSchema,
  type CreateMaterialFormValues,
  type CreateMaterialInput,
} from "@/lib/validation/reference-data";

import { createMaterialAction } from "./actions";

export function CreateMaterialForm({ projectId }: { projectId: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateMaterialFormValues, unknown, CreateMaterialInput>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: { name: "", unit: "", minimumBalance: 0, initialQuantity: 0 },
  });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createMaterialAction(projectId, data);
      if (!result.ok) {
        setServerError(result.error);
      } else {
        reset();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="material-name">Название</Label>
          <Input id="material-name" placeholder="Например, электрод" {...register("name")} />
          {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
        </div>
        <div className="flex w-20 flex-col gap-1">
          <Label htmlFor="material-unit">Ед.</Label>
          <Input id="material-unit" placeholder="кг, шт, л" {...register("unit")} />
          {errors.unit ? <p className="text-sm text-destructive">{errors.unit.message}</p> : null}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <div className="flex w-32 flex-col gap-1">
          <Label htmlFor="material-initial-quantity">Начальный остаток</Label>
          <Input
            id="material-initial-quantity"
            type="number"
            step="0.001"
            {...register("initialQuantity")}
          />
          {errors.initialQuantity ? (
            <p className="text-sm text-destructive">{errors.initialQuantity.message}</p>
          ) : null}
        </div>
        <div className="flex w-32 flex-col gap-1">
          <Label htmlFor="material-minimum-balance">Мин. остаток</Label>
          <Input
            id="material-minimum-balance"
            type="number"
            step="0.001"
            {...register("minimumBalance")}
          />
          {errors.minimumBalance ? (
            <p className="text-sm text-destructive">{errors.minimumBalance.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="mt-auto">
          {pending ? "Добавление…" : "Добавить"}
        </Button>
      </div>
      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
    </form>
  );
}
