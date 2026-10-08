import { toast } from "sonner";

import { undoCarryOverTaskAction } from "./actions";

/** Сколько держится уведомление с «Отменить» (быстрое завершение, перенос). */
export const UNDO_TOAST_MS = 6000;

/** Отмена переноса с уведомлением — общая для кнопки «↩» и «Отменить» после переноса. */
export async function undoCarryOver(projectId: string, taskId: string, onDone?: () => void): Promise<void> {
  const result = await undoCarryOverTaskAction(projectId, taskId);
  if (!result.ok) {
    toast.error(result.error);
  } else {
    toast.success(result.message ?? "Перенос отменён.");
    onDone?.();
  }
}

/** Уведомление об успешном переносе с кнопкой «Отменить». */
export function toastCarriedOver(message: string, projectId: string, taskId: string, onUndone?: () => void): void {
  toast.success(message, {
    duration: UNDO_TOAST_MS,
    action: { label: "Отменить", onClick: () => void undoCarryOver(projectId, taskId, onUndone) },
  });
}
