"use client";

import { Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { parseDecimal, parsePastedRows } from "@/lib/business/supply-paste";
import { suggestItemId } from "@/lib/business/supply-match";
import type { SupplyItemView } from "@/lib/types/supply";
import { cn } from "@/lib/utils";

// Вставка строк из Excel с редактируемым предпросмотром (спека §6.3).
// mode="items" — позиции заявки (с примечанием), mode="invoice" — строки счёта
// с выбором позиции заявки (подбор — §6.4).

export interface EditableRow {
  key: string;
  lineNo: number | null;
  name: string;
  unit: string;
  quantity: string;
  note: string;
  requestItemId: string | null;
}

export function rowIsValid(row: EditableRow): boolean {
  const quantity = parseDecimal(row.quantity);
  return row.name.trim() !== "" && row.unit.trim() !== "" && quantity !== null && quantity > 0;
}

let keySeq = 0;
const nextKey = () => `row-${++keySeq}`;

const emptyRow = (): EditableRow => ({
  key: nextKey(),
  lineNo: null,
  name: "",
  unit: "",
  quantity: "",
  note: "",
  requestItemId: null,
});

const CELL_INPUT =
  "h-7 w-full min-w-0 rounded-[6px] border border-control bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-brand";

export function PasteRows({
  mode,
  requestItems = [],
  rows,
  onChange,
}: {
  mode: "items" | "invoice";
  requestItems?: SupplyItemView[];
  rows: EditableRow[];
  onChange: (rows: EditableRow[]) => void;
}) {
  const [text, setText] = useState("");
  const textId = useId();
  const choosable = requestItems.filter((i) => !i.cancelled);

  const append = (raw: string) => {
    const parsed = parsePastedRows(raw).map(
      (r): EditableRow => ({
        key: nextKey(),
        lineNo: r.lineNo,
        name: r.name,
        unit: r.unit,
        quantity: r.quantity === null ? "" : String(r.quantity).replace(".", ","),
        note: r.note,
        requestItemId: mode === "invoice" ? suggestItemId(r.name, requestItems) : null,
      }),
    );
    if (parsed.length > 0) onChange([...rows, ...parsed]);
  };

  const update = (key: string, patch: Partial<EditableRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const invalidCount = rows.filter((r) => !rowIsValid(r)).length;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={textId} className="text-[12px] font-semibold text-ink-soft">
        Вставьте строки из Excel
      </label>
      <textarea
        id={textId}
        value={text}
        rows={3}
        placeholder={
          mode === "invoice"
            ? "Выделите в Excel колонки «Наименование», «Кол-во», «Ед.» (без цены и суммы), скопируйте и вставьте сюда"
            : "Выделите строки в Excel (наименование, ед., кол-во), скопируйте и вставьте сюда"
        }
        className="w-full resize-y rounded-[7px] border border-control bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-placeholder focus-visible:border-brand"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text/plain");
          if (pasted.includes("\t")) {
            e.preventDefault();
            append(pasted);
          }
        }}
      />
      <p className="text-[11px] text-meta">
        {mode === "invoice" &&
          "Колонки «Цена» и «Сумма» не копируйте: количеством считается последнее число в строке. "}
        Из PDF строки копируются без колонок — сначала вставьте их в Excel, затем скопируйте оттуда.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={text.trim() === ""}
          onClick={() => {
            append(text);
            setText("");
          }}
        >
          Разобрать
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, emptyRow()])}>
          + Строка вручную
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-ink-header">
                <th className="w-14 px-1 py-1">№</th>
                <th className="px-1 py-1">Наименование</th>
                <th className="w-20 px-1 py-1">Ед.</th>
                <th className="w-24 px-1 py-1">Кол-во</th>
                <th className="w-56 px-1 py-1">{mode === "items" ? "Примечание" : "Позиция заявки"}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  data-valid={rowIsValid(row)}
                  className={cn(!rowIsValid(row) && "bg-status-alert-bg/50")}
                  title={rowIsValid(row) ? undefined : "Не распознано — исправьте или удалите строку"}
                >
                  <td className="px-1 py-0.5">
                    <input
                      aria-label="№"
                      inputMode="numeric"
                      className={CELL_INPUT}
                      value={row.lineNo ?? ""}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        update(row.key, { lineNo: Number.isFinite(n) && n > 0 ? n : null });
                      }}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      aria-label="Наименование"
                      className={CELL_INPUT}
                      value={row.name}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      aria-label="Ед."
                      className={CELL_INPUT}
                      value={row.unit}
                      onChange={(e) => update(row.key, { unit: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      aria-label="Кол-во"
                      inputMode="decimal"
                      className={CELL_INPUT}
                      value={row.quantity}
                      onChange={(e) => update(row.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    {mode === "items" ? (
                      <input
                        aria-label="Примечание"
                        className={CELL_INPUT}
                        value={row.note}
                        onChange={(e) => update(row.key, { note: e.target.value })}
                      />
                    ) : (
                      <NativeSelect
                        aria-label="Позиция заявки"
                        className="h-7 text-[12px]"
                        value={row.requestItemId ?? ""}
                        onChange={(e) => update(row.key, { requestItemId: e.target.value || null })}
                      >
                        <option value="">— вне заявки —</option>
                        {choosable.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.lineNo}. {item.name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Удалить строку"
                      onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invalidCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[11.5px] text-status-alert-fg">
            Не распознано строк: {invalidCount}. Исправьте или удалите их — подсвечены красным.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter(rowIsValid))}>
            Удалить нераспознанные
          </Button>
        </div>
      )}
    </div>
  );
}

/** Строки предпросмотра → вход Zod-схемы позиций/строк счёта. */
export function toRowInputs(rows: EditableRow[]) {
  return rows.map((r) => ({
    lineNo: r.lineNo,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    note: r.note,
    requestItemId: r.requestItemId,
  }));
}
