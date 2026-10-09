"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, ArchiveRestoreIcon, PackagePlusIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { BalanceBadge } from "@/components/common/balance-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/business/material-report";
import { balanceState } from "@/lib/business/material-stock";
import { cn } from "@/lib/utils";
import {
  materialSchema,
  type MaterialInput,
  type MaterialFormValues,
} from "@/lib/validation/reference-data";

import { ReceiptForm } from "./[materialId]/receipt-form";
import { setMaterialActiveAction, updateMaterialAction } from "./actions";

/**
 * Колонки таблицы материалов на широком экране: название, остаток, минимум,
 * состояние, действия. Общие для строки и шапки (materials-list.tsx).
 */
export const MATERIAL_ROW_GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_8.5rem_5.75rem] sm:gap-x-3";

export type Material = {
  id: string;
  name: string;
  unit: string;
  current_balance: number;
  minimum_balance: number;
  is_active: boolean;
};

export function MaterialRow({
  projectId,
  material,
  canEdit,
}: {
  projectId: string;
  material: Material;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
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

  if (editing && canEdit) {
    const error = (message?: string) =>
      message ? <p className="text-[11.5px] text-status-alert-fg">{message}</p> : null;
    return (
      <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2 py-1.5" noValidate>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Input aria-label="Название" {...register("name")} autoFocus />
          {error(errors.name?.message)}
        </div>
        <div className="flex w-20 flex-col gap-1">
          <Input aria-label="Единица измерения" {...register("unit")} />
          {error(errors.unit?.message)}
        </div>
        <div className="flex w-28 flex-col gap-1">
          <Input aria-label="Минимальный остаток" type="number" step="0.001" {...register("minimumBalance")} />
          {error(errors.minimumBalance?.message)}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Сохранить
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </div>
      </form>
    );
  }

  const state = balanceState(material.current_balance, material.minimum_balance);

  return (
    <div className="py-2 sm:py-1.5">
      {/* Телефон: название и действия сверху, остаток/минимум/состояние под ними (order);
          на широком экране — колонки сетки в порядке DOM (sm:order-none). */}
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", MATERIAL_ROW_GRID)}>
        <Link
          href={`/${projectId}/materials/${material.id}`}
          className={cn(
            "order-1 min-w-0 flex-1 text-[12.5px] font-semibold text-ink underline-offset-2 hover:underline sm:order-none",
            !material.is_active && "text-meta line-through",
          )}
        >
          {material.name}
        </Link>
        <span aria-hidden className="order-3 basis-full sm:hidden" />
        <span className="order-4 text-[12.5px] whitespace-nowrap sm:order-none sm:text-right">
          <span
            className={cn(
              "font-semibold tabular-nums",
              state === "negative" && "text-status-alert-fg",
              state === "low" && "text-status-warn-fg",
              state === "ok" && "text-ink",
            )}
          >
            {formatQuantity(material.current_balance)}
          </span>{" "}
          <span className="text-meta">{material.unit}</span>
        </span>
        <span className="order-5 text-[12px] whitespace-nowrap text-meta tabular-nums sm:order-none sm:text-right">
          <span className="sm:hidden">мин. </span>
          {formatQuantity(material.minimum_balance)}
        </span>
        <span className="order-6 flex sm:order-none">
          {material.is_active ? (
            <BalanceBadge balance={material.current_balance} minimumBalance={material.minimum_balance} />
          ) : null}
        </span>
        {canEdit ? (
          <span className="order-2 -my-1 ml-auto flex items-center justify-end sm:order-none sm:my-0">
            {material.is_active ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Приход «${material.name}»`}
                  title="Приход"
                  aria-expanded={receiving}
                  className={receiving ? "text-brand" : undefined}
                  onClick={() => setReceiving((open) => !open)}
                >
                  <PackagePlusIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Изменить «${material.name}»`}
                  title="Изменить"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${material.is_active ? "Деактивировать" : "Активировать"} «${material.name}»`}
              title={material.is_active ? "Деактивировать" : "Активировать"}
              disabled={pending}
              onClick={toggleActive}
            >
              {material.is_active ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
            </Button>
          </span>
        ) : null}
      </div>
      {receiving && canEdit ? (
        <div className="mt-1.5 rounded-[8px] bg-surface-today p-2">
          <ReceiptForm
            projectId={projectId}
            materialId={material.id}
            unit={material.unit}
            compact
            onDone={() => setReceiving(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
