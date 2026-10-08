"use client";

import { useTransition } from "react";

import { UndoIcon } from "@/components/common/icons";

import { undoCarryOver } from "../tasks/[taskId]/undo-carry-over";
import { chipCornerButtonClass } from "./chip-corner-button";

const LABEL = "Отменить перенос";

/** «↩» на карточке последнего дня, появившегося переносом (lib/business/task-planning.ts:isUndoableCarryOver). */
export function UndoCarryOverChipButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(() => undoCarryOver(projectId, taskId));
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
      <UndoIcon size={13} />
    </button>
  );
}
