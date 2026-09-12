"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { taskMaterialSchema } from "@/lib/validation/task";

import { addTaskMaterialAction, removeTaskMaterialAction, updateTaskMaterialAction } from "./actions";

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
}: {
  projectId: string;
  taskId: string;
  materials: Material[];
  taskMaterials: TaskMaterialRow[];
}) {
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const usedMaterialIds = new Set(taskMaterials.map((tm) => tm.material_id));
  const availableMaterials = materials.filter(
    (m) => m.is_active && !usedMaterialIds.has(m.id),
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>Материалы</Label>

      {taskMaterials.length === 0 ? (
        <p className="text-sm text-muted-foreground">Расход материалов ещё не указан.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {taskMaterials.map((row) => (
            <TaskMaterialRowItem
              key={row.id}
              projectId={projectId}
              taskId={taskId}
              row={row}
              material={materialById.get(row.material_id) ?? null}
            />
          ))}
        </div>
      )}

      <AddTaskMaterialForm projectId={projectId} taskId={taskId} materials={availableMaterials} />
    </div>
  );
}

function TaskMaterialRowItem({
  projectId,
  taskId,
  row,
  material,
}: {
  projectId: string;
  taskId: string;
  row: TaskMaterialRow;
  material: Material | null;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [note, setNote] = useState(row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!material) return null;

  // Остаток без уже учтённого этой строкой расхода — сколько реально
  // доступно, если менять количество (current_balance уже уменьшен на row.quantity).
  const balanceBeforeThisRow = material.current_balance + row.quantity;
  const parsedQuantity = Number(quantity.replace(",", "."));
  const exceedsBalance = Number.isFinite(parsedQuantity) && parsedQuantity > balanceBeforeThisRow;
  const isLow = material.current_balance <= material.minimum_balance;

  const save = () => {
    setError(null);
    const parsed = taskMaterialSchema.shape.quantity.safeParse(quantity);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Некорректное количество.");
      return;
    }
    startTransition(async () => {
      const result = await updateTaskMaterialAction(projectId, taskId, row.id, parsed.data, note);
      if (!result.ok) {
        setError(result.error);
      } else {
        setEditing(false);
      }
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await removeTaskMaterialAction(projectId, taskId, row.id);
      if (!result.ok) setError(result.error);
    });
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1 py-1.5">
        <div className="flex items-start gap-2">
          <span className="flex-1 pt-1.5 text-sm">{material.name}</span>
          <Input
            type="number"
            step="0.001"
            min="0"
            className="w-24"
            value={quantity}
            disabled={pending}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
          />
          <span className="pt-1.5 text-sm text-muted-foreground">{material.unit}</span>
        </div>
        <Input
          placeholder="Примечание (необязательно)"
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
        />
        {exceedsBalance ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            Списание больше остатка (доступно {balanceBeforeThisRow} {material.unit}).
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
              setError(null);
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
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div>
        <span className="text-sm">{material.name}</span>{" "}
        <span className="text-sm text-muted-foreground">
          — {row.quantity} {material.unit}
        </span>
        {row.note ? <p className="text-xs text-muted-foreground">{row.note}</p> : null}
        {isLow ? (
          <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
            низкий остаток
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Изменить
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
          Удалить
        </Button>
      </div>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = materials.find((m) => m.id === materialId) ?? null;
  const parsedQuantity = Number(quantity.replace(",", "."));
  const exceedsBalance =
    selected && Number.isFinite(parsedQuantity) && parsedQuantity > selected.current_balance;

  const onSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);

    const parsed = taskMaterialSchema.safeParse({ materialId, quantity, note: note || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте правильность заполнения формы.");
      return;
    }

    startTransition(async () => {
      const result = await addTaskMaterialAction(projectId, taskId, parsed.data);
      if (!result.ok) {
        setError(result.error);
      } else {
        setMaterialId("");
        setQuantity("");
        setNote("");
      }
    });
  };

  if (materials.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Нет доступных материалов для добавления. Добавьте материал в справочнике или измените
        количество уже указанных выше.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 pt-1" noValidate>
      <div className="flex items-start gap-2">
        <select
          value={materialId}
          disabled={pending}
          onChange={(e) => setMaterialId(e.target.value)}
          className="h-8 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Выберите материал…</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} (остаток {m.current_balance} {m.unit})
            </option>
          ))}
        </select>
        <Input
          type="number"
          step="0.001"
          min="0"
          placeholder="Кол-во"
          className="w-24"
          value={quantity}
          disabled={pending}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      <Input
        placeholder="Примечание (необязательно)"
        value={note}
        disabled={pending}
        onChange={(e) => setNote(e.target.value)}
      />
      {exceedsBalance ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Списание больше остатка (доступно {selected!.current_balance} {selected!.unit}).
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" disabled={pending || !materialId} className="self-start">
        {pending ? "Добавление…" : "Добавить материал"}
      </Button>
    </form>
  );
}
