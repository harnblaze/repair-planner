"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  materialSchema,
  type MaterialInput,
  type MaterialFormValues,
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
  } = useForm<MaterialFormValues, unknown, MaterialInput>({
    resolver: zodResolver(materialSchema),
    defaultValues: { name: "", unit: "", minimumBalance: 0 },
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
          <Input placeholder="Название" {...register("name")} />
          {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
        </div>
        <div className="flex w-20 flex-col gap-1">
          <Input placeholder="Ед." {...register("unit")} />
          {errors.unit ? <p className="text-sm text-destructive">{errors.unit.message}</p> : null}
        </div>
        <div className="flex w-28 flex-col gap-1">
          <Input
            type="number"
            step="0.001"
            placeholder="Мин. остаток"
            {...register("minimumBalance")}
          />
          {errors.minimumBalance ? (
            <p className="text-sm text-destructive">{errors.minimumBalance.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Добавление…" : "Добавить"}
        </Button>
      </div>
      {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
    </form>
  );
}
