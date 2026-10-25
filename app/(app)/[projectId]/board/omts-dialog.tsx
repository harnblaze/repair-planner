"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildOmtsHtml, buildOmtsTsv, omtsMonthLabel, parseOrderItem } from "@/lib/business/omts-request";
import {
  omtsHeaderSchema,
  type OmtsHeaderFormValues,
  type OmtsHeaderInput,
} from "@/lib/validation/omts-request";

import { FieldError, SupplyDialog } from "../supply/supply-dialog";
import type { BoardItem } from "./board-item-row";

// Поля шапки, кроме месяца, запоминаются в браузере: мастер подаёт заявку
// каждый месяц с теми же организацией и подписантом.
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const STORAGE_KEY = "repair-planner:omts-header";

const DEFAULT_DEPARTMENT = "ремонтно-строительного цеха (РСЦ)";
const DEFAULT_SIGNER_TITLE = "Начальник цеха";

type RememberedHeader = Pick<OmtsHeaderInput, "organization" | "department" | "signerTitle" | "signerName">;

const REMEMBERED_DEFAULTS: RememberedHeader = {
  organization: "",
  department: DEFAULT_DEPARTMENT,
  signerTitle: DEFAULT_SIGNER_TITLE,
  signerName: "",
};

function readRemembered(): RememberedHeader {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const saved = parsed as Record<string, unknown>;
      const pick = (key: keyof RememberedHeader) =>
        typeof saved[key] === "string" ? (saved[key] as string) : REMEMBERED_DEFAULTS[key];
      return {
        organization: pick("organization"),
        department: pick("department"),
        signerTitle: pick("signerTitle"),
        signerName: pick("signerName"),
      };
    }
  } catch {
    // Хранилище недоступно (приватное окно) или значение испорчено — по умолчанию.
  }
  return REMEMBERED_DEFAULTS;
}

function writeRemembered(data: OmtsHeaderInput) {
  const value: RememberedHeader = {
    organization: data.organization,
    department: data.department,
    signerTitle: data.signerTitle,
    signerName: data.signerName,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Не сохранилось — в следующий раз поля будут по умолчанию.
  }
}

function summaryText(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last === 1 && last2 !== 11) return `В заявку попадёт ${n} пункт.`;
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return `В заявку попадут ${n} пункта.`;
  return `В заявку попадут ${n} пунктов.`;
}

export function OmtsDialog({
  projectId,
  listId,
  items,
  today,
  open,
  onOpenChange,
}: {
  projectId: string;
  listId: string;
  items: BoardItem[];
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Только невыполненные пункты, в порядке списка.
  const rows = useMemo(
    () => items.filter((i) => !i.is_done).map((i) => parseOrderItem(i.title, i.note)),
    [items],
  );
  const unparsed = rows.filter((r) => !r.parsed);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OmtsHeaderFormValues, unknown, OmtsHeaderInput>({
    resolver: zodResolver(omtsHeaderSchema),
    defaultValues: { month: today.slice(0, 7), ...readRemembered() },
  });

  const download = handleSubmit(async (data) => {
    setBusy(true);
    try {
      const res = await fetch(`/${projectId}/board/omts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId, ...data }),
      });
      const type = res.headers.get("Content-Type") ?? "";
      // Редирект на /login (сессия истекла) приходит как 200 с HTML — это не файл.
      if (res.redirected || type.includes("text/html")) {
        toast.error("Сессия истекла. Войдите заново и повторите.");
        return;
      }
      if (!res.ok) {
        const message = type.includes("text/plain") ? (await res.text()).trim() : "";
        toast.error(message || "Не удалось собрать заявку. Попробуйте ещё раз.");
        return;
      }
      if (!type.includes(XLSX_TYPE)) {
        toast.error("Не удалось собрать заявку. Попробуйте ещё раз.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Заявка ТМЦ ${omtsMonthLabel(data.month)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Не сразу: браузер должен успеть начать скачивание.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      writeRemembered(data);
      toast.success("Файл заявки скачан.");
    } catch (error) {
      console.error("omts download", error);
      toast.error("Не удалось собрать заявку. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  });

  // Без валидации шапки и без async до записи в буфер: Safari требует, чтобы
  // clipboard.write вызывался прямо в обработчике клика.
  const copy = () => {
    const tsv = buildOmtsTsv(rows);
    const html = buildOmtsHtml(rows);
    const fallback = () => navigator.clipboard.writeText(tsv);
    let written: Promise<void>;
    try {
      written =
        typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
          ? navigator.clipboard
              .write([
                new ClipboardItem({
                  "text/plain": new Blob([tsv], { type: "text/plain" }),
                  "text/html": new Blob([html], { type: "text/html" }),
                }),
              ])
              .catch((error) => {
                console.error("omts clipboard.write", error);
                return fallback();
              })
          : fallback();
    } catch (error) {
      written = Promise.reject(error);
    }
    written.then(
      () => toast.success("Строки скопированы — вставьте их в первую строку таблицы заявки."),
      (error) => {
        console.error("omts copy", error);
        toast.error("Не удалось скопировать. Попробуйте ещё раз.");
      },
    );
  };

  return (
    <SupplyDialog open={open} onOpenChange={onOpenChange} title="Заявка в ОМТС">
      <form onSubmit={download} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="omts-month">Месяц</Label>
          <Input id="omts-month" type="month" aria-invalid={!!errors.month} {...register("month")} />
          <FieldError message={errors.month?.message} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="omts-organization">Организация</Label>
          <Input
            id="omts-organization"
            placeholder="ООО «…»"
            aria-invalid={!!errors.organization}
            {...register("organization")}
          />
          <FieldError message={errors.organization?.message} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="omts-department">От кого</Label>
          <Input id="omts-department" aria-invalid={!!errors.department} {...register("department")} />
          <p className="text-[11px] text-faint">В файле: «от …»</p>
          <FieldError message={errors.department?.message} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="omts-signer-title">Должность подписанта</Label>
          <Input id="omts-signer-title" aria-invalid={!!errors.signerTitle} {...register("signerTitle")} />
          <FieldError message={errors.signerTitle?.message} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="omts-signer-name">ФИО подписанта</Label>
          <Input id="omts-signer-name" aria-invalid={!!errors.signerName} {...register("signerName")} />
          <FieldError message={errors.signerName?.message} />
        </div>

        <div className="text-[12px] text-muted-foreground">
          <p>{summaryText(rows.length)}</p>
          {unparsed.length > 0 ? (
            <p className="mt-1">
              Без количества (заполните в файле): {unparsed.map((r) => r.name).join(", ")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={busy} onClick={copy}>
            Скопировать строки
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Собираю…" : "Скачать файл"}
          </Button>
        </div>
      </form>
    </SupplyDialog>
  );
}
