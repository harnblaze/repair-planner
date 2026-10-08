"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { ArrowRightIcon } from "@/components/common/icons";

import { carryOverTaskAction } from "../tasks/[taskId]/actions";
import { toastCarriedOver } from "../tasks/[taskId]/undo-carry-over";
import { chipCornerButtonClass } from "./chip-corner-button";

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
        toastCarriedOver(result.message ?? "Перенесено.", projectId, taskId);
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
      className={chipCornerButtonClass(pending)}
    >
      <ArrowRightIcon size={13} />
    </button>
  );
}
