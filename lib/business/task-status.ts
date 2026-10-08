import type { Database } from "@/lib/types/database";

export type TaskStatus = Database["public"]["Enums"]["task_status"];

// Порядок значим — используется для сортировки и порядка в <select>.
// UI показывает русские названия, в БД и коде — только стабильные значения (CLAUDE.md §17).
export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "planned", label: "Запланирована" },
  { value: "in_progress", label: "В работе" },
  { value: "paused", label: "Приостановлена" },
  { value: "completed", label: "Завершена" },
  { value: "cancelled", label: "Отменена" },
];

const LABEL_BY_STATUS = new Map(TASK_STATUSES.map((s) => [s.value, s.label]));

export function taskStatusLabel(status: TaskStatus): string {
  return LABEL_BY_STATUS.get(status) ?? status;
}
