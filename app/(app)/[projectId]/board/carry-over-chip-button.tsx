"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { ArrowRightIcon } from "@/components/common/icons";
import { cn } from "@/lib/utils";

import { carryOverTaskAction } from "../tasks/[taskId]/actions";

const LABEL = "Перенести на следующий рабочий день";

/**
 * Перенос с карточки доски — то же действие, что на странице заявки.
 * Лежит рядом со ссылкой карточки, а не внутри неё: кнопка внутри <a>
 * недопустима, и клик по ней открывал бы заявку.
 */
export function CarryOverChipButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await carryOverTaskAction(projectId, taskId);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Перенесено.");
      }
    });
  };

  return (
    <button
      type="button"
      aria-label={LABEL}
      title={LABEL}
      disabled={pending}
      onClick={onClick}
      className={cn(
        "absolute right-1 bottom-1 flex size-7 items-center justify-center rounded-md text-meta transition-[opacity,color,background-color] duration-120 hover:bg-row-hover hover:text-ink disabled:opacity-50",
        // На компьютере — при наведении на карточку или фокусе; на телефоне наведения нет, кнопка видна всегда.
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        pending && "opacity-100",
      )}
    >
      <ArrowRightIcon size={13} />
    </button>
  );
}
