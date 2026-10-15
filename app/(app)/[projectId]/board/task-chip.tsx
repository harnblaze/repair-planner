import Link from "next/link";

import { ArrowRightIcon, BookmarkIcon, CameraIcon } from "@/components/common/icons";
import { BADGE_BASE, StatusBadge } from "@/components/common/status-badge";
import { executorsInitials } from "@/lib/business/executor-names";
import type { TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

import type { TaskExecutor } from "./task-updates";

export type BoardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  categoryName: string | null;
  /** Назначенные исполнители, по имени (page.tsx). */
  executors: TaskExecutor[];
  // День — история: после него задачу перенесли или отложили
  // (product-requirements.md §4.3, §4.4). Карточка приглушается.
  isHistory?: boolean;
  transferNote?: string | null;
  /** Дополнительная очередь заявки — метка на карточке в дне (lib/business/backlog-queues.ts:queueLabel). */
  queueName?: string | null;
  /** Последний день появился переносом, и его ещё можно отменить (task-planning.ts:isUndoableCarryOver). */
  undoableCarryOver?: boolean;
  /** Сколько фото у заявки (task_attachments); 0 — значок не показывается. */
  photoCount?: number;
};

// Пропсы перетаскивания (ref, listeners, style) передаются прямо на ссылку:
// у карточки одна точка фокуса и для перехода, и для перетаскивания с клавиатуры.
type LinkRestProps = Omit<React.ComponentProps<typeof Link>, "href" | "children">;

// Кнопки угла по 28px (size-7) + отступ right-1.
const CORNER_PADDING: Record<number, string> = { 1: "pr-6", 2: "pr-14", 3: "pr-21" };

// Статус вынесен в бейдж, поэтому в текстовые метаданные он больше не входит.
// Исполнители — «Иванов И., Петров П. +1», как в меню быстрой правки.
function metaOf(task: BoardTask): string {
  return [task.categoryName, executorsInitials(task.executors.map((e) => e.name))].filter(Boolean).join(" · ");
}

/**
 * Карточка задачи в колонке рабочего дня (docs/redesign.md §5).
 *
 * Ссылка — заголовок, растянутый на всю карточку (after:inset-0): нажатие в
 * любом месте открывает заявку, а кнопки быстрой правки (statusControl,
 * executorsControl) лежат поверх неё — кнопку нельзя вкладывать в ссылку.
 * Пропсы перетаскивания (rest) — на ссылке, className — на самой карточке.
 */
export function TaskChip({
  projectId,
  task,
  cornerButtons = 0,
  statusControl,
  executorsControl,
  className,
  ...rest
}: {
  projectId: string;
  task: BoardTask;
  /**
   * Сколько кнопок в правом нижнем углу: под них резервируется место в строке
   * статуса, заголовок сохраняет всю ширину колонки и не ломает слова.
   */
  cornerButtons?: number;
  /** Кнопка-меню статуса вместо бейджа (quick-edit-menus.tsx). */
  statusControl?: React.ReactNode;
  /** Кнопка-меню исполнителей вместо их имён в метаданных. */
  executorsControl?: React.ReactNode;
} & LinkRestProps) {
  const meta = executorsControl ? task.categoryName : metaOf(task);
  const isHistory = Boolean(task.isHistory);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-[5px] rounded-[7px] border border-line-card bg-surface px-2.5 pt-2 pb-[9px] transition-[border-color,box-shadow] duration-120 hover:border-line-card-hover hover:shadow-[0_1px_2px_rgba(20,30,50,0.06)] has-[a:focus-visible]:border-brand has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-brand/12",
        isHistory && "opacity-[0.66]",
        className,
      )}
    >
      {/* Заголовок занимает отдельную строку: в колонке ~165px он не должен
          делить строку с бейджем, иначе слова ломаются посередине. */}
      <Link
        href={`/${projectId}/tasks/${task.id}`}
        // Нативное перетаскивание ссылки браузером конфликтует с drag-and-drop доски.
        draggable={false}
        {...rest}
        className="text-[13px] leading-snug font-semibold tracking-[-0.005em] break-words text-ink outline-none after:absolute after:inset-0 after:rounded-[7px] after:content-['']"
      >
        {task.title}
      </Link>
      <span className={cn("flex flex-wrap items-center gap-1.5", CORNER_PADDING[cornerButtons])}>
        {statusControl ?? <StatusBadge status={task.status} muted={isHistory} />}
        {task.queueName ? (
          <span
            className={cn(BADGE_BASE, "inline-flex items-center gap-1 border border-line-card bg-surface py-[3px] text-meta-alt")}
            title={`Очередь: ${task.queueName}`}
          >
            <BookmarkIcon size={10} className="shrink-0" />
            <span className="truncate">{task.queueName}</span>
          </span>
        ) : null}
        {task.photoCount ? (
          <span
            className={cn(BADGE_BASE, "inline-flex items-center gap-1 border border-line-card bg-surface py-[3px] text-meta-alt")}
            title={`Фото: ${task.photoCount}`}
          >
            <CameraIcon size={10} className="shrink-0" />
            {task.photoCount}
          </span>
        ) : null}
        {meta ? <span className="text-[11.5px] break-words text-meta">{meta}</span> : null}
        {executorsControl}
      </span>
      {task.transferNote ? (
        <span className="mt-px flex items-start gap-[5px] border-t border-dashed border-line-card pt-1.5 text-[11px] text-meta-dim">
          <ArrowRightIcon size={11} className="mt-[3px] shrink-0" />
          {task.transferNote}
        </span>
      ) : null}
    </div>
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
      {task.photoCount ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-meta-alt" title={`Фото: ${task.photoCount}`}>
          <CameraIcon size={11} className="shrink-0" />
          {task.photoCount}
        </span>
      ) : null}
      <StatusBadge status={task.status} />
    </Link>
  );
}
