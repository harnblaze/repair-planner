"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { CheckIcon } from "@/components/common/icons";
import type { TaskStatus } from "@/lib/business/task-status";

import { setTaskStatusAction } from "../tasks/[taskId]/actions";
import { chipCornerButtonClass } from "./chip-corner-button";

const LABEL = "Завершить заявку";
const UNDO_TOAST_MS = 6000;

/**
 * Завершение с карточки доски — то же действие, что выбор статуса на странице
 * заявки. «Отменить» в уведомлении возвращает статус, бывший до нажатия.
 */
export function CompleteChipButton({
  projectId,
  taskId,
  previousStatus,
}: {
  projectId: string;
  taskId: string;
  previousStatus: TaskStatus;
}) {
  const [pending, startTransition] = useTransition();

  const undo = async () => {
    const result = await setTaskStatusAction(projectId, taskId, previousStatus);
    if (!result.ok) toast.error(result.error);
  };

  const onClick = () => {
    startTransition(async () => {
      const result = await setTaskStatusAction(projectId, taskId, "completed");
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Заявка завершена.", {
          duration: UNDO_TOAST_MS,
          action: { label: "Отменить", onClick: () => void undo() },
        });
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
      <CheckIcon size={13} />
    </button>
  );
}
