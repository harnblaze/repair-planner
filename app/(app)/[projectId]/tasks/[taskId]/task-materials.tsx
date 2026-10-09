"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { BalanceBadge } from "@/components/common/balance-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { taskMaterialSchema } from "@/lib/validation/task";

import { addTaskMaterialAction, removeTaskMaterialAction, updateTaskMaterialAction } from "./actions";
import { SectionHeader } from "./section-header";

type Material = {
  id: string;
  name: string;
  unit: string;
  current_balance: number;
  minimum_balance: number;
  is_active: boolean;
};

type TaskMaterialRow = {
  id: string;
  material_id: string;
  quantity: number;
  note: string | null;
};

export function TaskMaterials({
  projectId,
  taskId,
  materials,
  taskMaterials,
  canEdit,
}: {
  projectId: string;
  taskId: string;
  materials: Material[];
  taskMaterials: TaskMaterialRow[];
  /** false — только просмотр: список расхода без правки и добавления. */
  canEdit: boolean;
}) {
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const usedMaterialIds = new Set(taskMaterials.map((tm) => tm.material_id));
  const availableMaterials = materials.filter(
    (m) => m.is_active && !usedMaterialIds.has(m.id),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <SectionHeader title="Материалы" count={taskMaterials.length} />

      {taskMaterials.length === 0 ? (
        <EmptyState>Расход материалов ещё не указан.</EmptyState>
      ) : (
        <div className="flex flex-col divide-y divide-line-subtle">
          {taskMaterials.map((row) => (
            <TaskMaterialRowItem
              key={row.id}
              projectId={projectId}
              taskId={taskId}
              row={row}
              material={materialById.get(row.material_id) ?? null}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <AddTaskMaterialForm projectId={projectId} taskId={taskId} materials={availableMaterials} />
      ) : null}
    </div>
  );
}

function TaskMaterialRowItem({
  projectId,
  taskId,
  row,
  material,
  canEdit,
}: {
  projectId: string;
  taskId: string;
  row: TaskMaterialRow;
  material: Material | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [note, setNote] = useState(row.note ?? "");
  const [pending, startTransition] = useTransition();

  if (!material) return null;

  // Остаток без уже учтённого этой строкой расхода — сколько реально
  // доступно, если менять количество (current_balance уже уменьшен на row.quantity).
  const balanceBeforeThisRow = material.current_balance + row.quantity;
  const parsedQuantity = Number(quantity.replace(",", "."));
  const exceedsBalance = Number.isFinite(parsedQuantity) && parsedQuantity > balanceBeforeThisRow;

  const save = () => {
    const parsed = taskMaterialSchema.shape.quantity.safeParse(quantity);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Некорректное количество.");
      return;
    }
    startTransition(async () => {
      const result = await updateTaskMaterialAction(projectId, taskId, row.id, parsed.data, note);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Расход обновлён.");
        setEditing(false);
      }
    });
  };

  const remove = () => {
    if (!window.confirm(`Удалить расход «${material.name}»?`)) return;
    startTransition(async () => {
      const result = await removeTaskMaterialAction(projectId, taskId, row.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Расход удалён.");
      }
    });
  };

  if (editing && canEdit) {
    return (
      <div className="flex flex-col gap-1 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 basis-full text-[12.5px] font-semibold text-ink sm:basis-auto">
            {material.name}
          </span>
          <Input
            type="number"
            step="0.001"
            min="0"
            aria-label="Количество"
            className="w-24"
            value={quantity}
            disabled={pending}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
          />
          <span className="text-[12px] text-meta">{material.unit}</span>
          <Input
            placeholder="Примечание (необязательно)"
            aria-label="Примечание"
            className="w-auto min-w-40 flex-1"
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {exceedsBalance ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            Списание больше остатка (доступно {balanceBeforeThisRow} {material.unit}).
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            Сохранить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setQuantity(String(row.quantity));
              setNote(row.note ?? "");
              setEditing(false);
            }}
          >
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0">
        <span className="text-[12.5px] font-semibold text-ink">{material.name}</span>{" "}
        <span className="text-[12px] text-meta">
          — {row.quantity} {material.unit}
          {row.note ? ` · ${row.note}` : ""}
        </span>
        <BalanceBadge
          className="ml-2 align-middle"
          balance={material.current_balance}
          minimumBalance={material.minimum_balance}
        />
      </div>
      {canEdit ? (
        <div className="flex flex-none items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Изменить расход «${material.name}»`}
            title="Изменить"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Удалить расход «${material.name}»`}
            title="Удалить"
            disabled={pending}
            onClick={remove}
          >
            <Trash2Icon />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AddTaskMaterialForm({
  projectId,
  taskId,
  materials,
}: {
  projectId: string;
  taskId: string;
  materials: Material[];
}) {
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const selected = materials.find((m) => m.id === materialId) ?? null;
  const parsedQuantity = Number(quantity.replace(",", "."));
  const exceedsBalance =
    selected && Number.isFinite(parsedQuantity) && parsedQuantity > selected.current_balance;

  const onSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();

    const parsed = taskMaterialSchema.safeParse({ materialId, quantity, note: note || undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения формы.");
      return;
    }

    startTransition(async () => {
      const result = await addTaskMaterialAction(projectId, taskId, parsed.data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Материал добавлен в заявку.");
        setMaterialId("");
        setQuantity("");
        setNote("");
      }
    });
  };

  if (materials.length === 0) {
    return (
      <p className="text-[11px] text-meta-alt">
        Нет доступных материалов для добавления. Добавьте материал в справочнике или измените
        количество уже указанных выше.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5 pt-1" noValidate>
      {/* Одна строка на широком экране; на телефоне — материал с количеством, ниже примечание с кнопкой. */}
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1.5fr)_auto]">
        <NativeSelect
          aria-label="Материал"
          value={materialId}
          disabled={pending}
          onChange={(e) => setMaterialId(e.target.value)}
        >
          <option value="">Выберите материал…</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} (остаток {m.current_balance} {m.unit})
            </option>
          ))}
        </NativeSelect>
        <Input
          type="number"
          step="0.001"
          min="0"
          placeholder="Кол-во"
          aria-label="Количество"
          value={quantity}
          disabled={pending}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Input
          placeholder="Примечание"
          aria-label="Примечание (необязательно)"
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" disabled={pending || !materialId}>
          {pending ? "Добавление…" : "Добавить"}
        </Button>
      </div>
      {exceedsBalance ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Списание больше остатка (доступно {selected!.current_balance} {selected!.unit}).
        </p>
      ) : null}
    </form>
  );
}
