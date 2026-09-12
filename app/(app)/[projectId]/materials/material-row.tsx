"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BalanceBadge } from "@/components/common/balance-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  materialSchema,
  type MaterialInput,
  type MaterialFormValues,
} from "@/lib/validation/reference-data";

import { setMaterialActiveAction, updateMaterialAction } from "./actions";

type Material = {
  id: string;
  name: string;
  unit: string;
  current_balance: number;
  minimum_balance: number;
  is_active: boolean;
};

export function MaterialRow({ projectId, material }: { projectId: string; material: Material }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MaterialFormValues, unknown, MaterialInput>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      name: material.name,
      unit: material.unit,
      minimumBalance: material.minimum_balance,
    },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await updateMaterialAction(projectId, material.id, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Изменения сохранены.");
        setEditing(false);
      }
    });
  });

  const toggleActive = () => {
    startTransition(async () => {
      const result = await setMaterialActiveAction(projectId, material.id, !material.is_active);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(material.is_active ? "Материал деактивирован." : "Материал активирован.");
      }
    });
  };

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex items-start gap-2 py-1" noValidate>
        <div className="flex flex-1 flex-col gap-1">
          <Input {...register("name")} autoFocus />
          {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
        </div>
        <div className="flex w-20 flex-col gap-1">
          <Input {...register("unit")} />
          {errors.unit ? <p className="text-[11.5px] text-status-alert-fg">{errors.unit.message}</p> : null}
        </div>
        <div className="flex w-28 flex-col gap-1">
          <Input type="number" step="0.001" {...register("minimumBalance")} />
          {errors.minimumBalance ? (
            <p className="text-[11.5px] text-status-alert-fg">{errors.minimumBalance.message}</p>
          ) : null}
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          Сохранить
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Отмена
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className={material.is_active ? "" : "text-meta line-through"}>
        <span className="text-[12.5px] font-semibold text-ink">{material.name}</span>{" "}
        <span className="font-mono text-[11.5px] text-meta">
          — {material.current_balance} / мин. {material.minimum_balance} {material.unit}
        </span>
        <BalanceBadge
          className="ml-2 align-middle"
          balance={material.current_balance}
          minimumBalance={material.minimum_balance}
        />
      </div>
      <div className="flex items-center gap-2">
        {material.is_active ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Изменить
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
          {material.is_active ? "Деактивировать" : "Активировать"}
        </Button>
      </div>
    </div>
  );
}
