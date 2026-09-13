import Link from "next/link";

import { ArrowRightIcon } from "@/components/common/icons";
import { StatusBadge } from "@/components/common/status-badge";
import type { TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

export type BoardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  categoryName: string | null;
  executorNames: string[];
  // День — история: после него задачу перенесли или отложили
  // (product-requirements.md §4.3, §4.4). Карточка приглушается.
  isHistory?: boolean;
  transferNote?: string | null;
};

// Пропсы перетаскивания (ref, listeners, style) передаются прямо на ссылку:
// у карточки одна точка фокуса и для перехода, и для перетаскивания с клавиатуры.
type LinkRestProps = Omit<React.ComponentProps<typeof Link>, "href" | "children">;

// Статус вынесен в бейдж, поэтому в текстовые метаданные он больше не входит.
function metaOf(task: BoardTask): string {
  return [task.categoryName, ...task.executorNames].filter(Boolean).join(" · ");
}

/** Карточка задачи в колонке рабочего дня (docs/redesign.md §5). */
export function TaskChip({
  projectId,
  task,
  className,
  ...rest
}: { projectId: string; task: BoardTask } & LinkRestProps) {
  const meta = metaOf(task);
  const isHistory = Boolean(task.isHistory);

  return (
    <Link
      href={`/${projectId}/tasks/${task.id}`}
      // Нативное перетаскивание ссылки браузером конфликтует с drag-and-drop доски.
      draggable={false}
      {...rest}
      className={cn(
        "flex flex-col gap-[5px] rounded-[7px] border border-line-card bg-surface px-2.5 pt-2 pb-[9px] transition-[border-color,box-shadow] duration-120 hover:border-line-card-hover hover:shadow-[0_1px_2px_rgba(20,30,50,0.06)]",
        isHistory && "opacity-[0.66]",
        className,
      )}
    >
      {/* Заголовок занимает отдельную строку: в колонке ~165px он не должен
          делить строку с бейджем, иначе слова ломаются посередине. */}
      <span className="text-[13px] leading-snug font-semibold tracking-[-0.005em] break-words text-ink">
        {task.title}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} muted={isHistory} />
        {meta ? <span className="text-[11.5px] break-words text-meta">{meta}</span> : null}
      </span>
      {task.transferNote ? (
        <span className="mt-px flex items-start gap-[5px] border-t border-dashed border-line-card pt-1.5 text-[11px] text-meta-dim">
          <ArrowRightIcon size={11} className="mt-[3px] shrink-0" />
          {task.transferNote}
        </span>
      ) : null}
    </Link>
  );
}

/** Компактная строка задачи в панели «Текущие заявки» (docs/redesign.md §6). */
export function TaskRow({
  projectId,
  task,
  className,
  ...rest
}: { projectId: string; task: BoardTask } & LinkRestProps) {
  const meta = metaOf(task);

  return (
    <Link
      href={`/${projectId}/tasks/${task.id}`}
      draggable={false}
      {...rest}
      className={cn(
        "flex items-center gap-2.5 rounded-[7px] px-[9px] py-2 transition-colors duration-120 hover:bg-row-hover",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px] font-semibold text-ink">{task.title}</span>
        {meta ? <span className="truncate text-[11px] text-meta-alt">{meta}</span> : null}
      </span>
      <StatusBadge status={task.status} />
    </Link>
  );
}
