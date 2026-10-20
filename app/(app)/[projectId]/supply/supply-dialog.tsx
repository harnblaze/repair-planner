"use client";

import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Модальное окно раздела «Снабжение»: светлая карточка, прокрутка содержимого. */
export function SupplyDialog({
  open,
  onOpenChange,
  title,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Широкое окно — для таблиц вставки. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Popup
          className={cn(
            "fixed top-[4vh] left-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-[10px] bg-surface shadow-[0_12px_40px_rgba(15,23,42,0.18)] outline-none",
            wide ? "max-w-4xl" : "max-w-md",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
            <Dialog.Title className="text-[14px] font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close aria-label="Закрыть" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <XIcon />
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-[11px] text-status-alert-fg">{message}</p> : null;
}
