import Link from "next/link";

import { ArrowRightIcon, BookmarkIcon, CameraIcon, UserIcon } from "@/components/common/icons";
import { StatusBadge } from "@/components/common/status-badge";
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

// Строка панели очереди: статус вынесен в бейдж, исполнители — «Иванов И., Петров П. +1».
function metaOf(task: BoardTask): string {
  return [task.categoryName, executorsInitials(task.executors.map((e) => e.name))].filter(Boolean).join(" · ");
}

/** «Иванов И., Петров П., Сидоров С.» — на своей строке помещаются три фамилии. */
export const CHIP_EXECUTORS_VISIBLE = 3;

/**
 * Карточка задачи в колонке рабочего дня (docs/redesign.md §5): название и
 * статус справа вверху (название обтекает бейдж), ниже цех-заказчик, ниже
 * исполнители — каждый на своём месте, без кнопок в углу.
 *
 * Ссылка — заголовок, растянутый на всю карточку (after:inset-0): нажатие в
 * любом месте открывает заявку, а кнопки быстрой правки (statusControl,
 * executorsControl) лежат поверх неё — кнопку нельзя вкладывать в ссылку.
 * Пропсы перетаскивания (rest) — на ссылке, className — на самой карточке.
 */
export function TaskChip({
  projectId,
  task,
  statusControl,
  executorsControl,
  className,
  ...rest
}: {
  projectId: string;
  task: BoardTask;
  /** Кнопка-меню статуса вместо бейджа (quick-edit-menus.tsx). */
  statusControl?: React.ReactNode;
  /** Кнопка-меню исполнителей вместо строки с их именами. */
  executorsControl?: React.ReactNode;
} & LinkRestProps) {
  const isHistory = Boolean(task.isHistory);
  const hasMeta = Boolean(task.categoryName || task.queueName || task.photoCount);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 rounded-[7px] border border-line-card bg-surface px-2.5 pt-2 pb-[9px] transition-[border-color,box-shadow] duration-120 hover:border-line-card-hover hover:shadow-[0_1px_2px_rgba(20,30,50,0.06)] has-[a:focus-visible]:border-brand has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-brand/12",
        isHistory && "opacity-[0.66]",
        className,
      )}
    >
      {/* Бейдж прижат вправо float-ом, название его обтекает: отдельный столбец
          под статус в колонке ~165px сжал бы название и ломал слова. */}
      <div className="text-[13px] leading-snug">
        <span className="float-right mb-0.5 ml-2 flex max-w-[60%]">
          {statusControl ?? <StatusBadge status={task.status} muted={isHistory} />}
        </span>
        <Link
          href={`/${projectId}/tasks/${task.id}`}
          // Нативное перетаскивание ссылки браузером конфликтует с drag-and-drop доски.
          draggable={false}
          {...rest}
          className="font-semibold tracking-[-0.005em] break-words text-ink outline-none after:absolute after:inset-0 after:rounded-[7px] after:content-['']"
        >
          {task.title}
        </Link>
      </div>
      {hasMeta ? (
        <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-meta-alt">
          {task.queueName ? (
            <span className="inline-flex min-w-0 shrink items-center gap-1" title={`Очередь: ${task.queueName}`}>
              <BookmarkIcon size={10} className="shrink-0" />
              <span className="truncate">{task.queueName}</span>
            </span>
          ) : null}
          {task.photoCount ? (
            <span className="inline-flex shrink-0 items-center gap-1" title={`Фото: ${task.photoCount}`}>
              <CameraIcon size={10} className="shrink-0" />
              {task.photoCount}
            </span>
          ) : null}
          {task.categoryName ? <span className="min-w-0 truncate text-meta">{task.categoryName}</span> : null}
        </span>
      ) : null}
      {executorsControl ??
        (task.executors.length > 0 ? (
          <span className="flex items-start gap-1 text-[11.5px] text-meta">
            <UserIcon size={11} className="mt-[2px] shrink-0" />
            {executorsInitials(
              task.executors.map((e) => e.name),
              CHIP_EXECUTORS_VISIBLE,
            )}
          </span>
        ) : null)}
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
        "flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-[7px] px-[9px] py-2 transition-colors duration-120 hover:bg-row-hover",
        className,
      )}
    >
      <span className="flex min-w-[110px] flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold break-words text-ink">{task.title}</span>
        {meta ? <span className="text-[11px] break-words text-meta-alt">{meta}</span> : null}
      </span>
      {task.photoCount ? (
        <span className="mt-px inline-flex shrink-0 items-center gap-1 text-[11px] text-meta-alt" title={`Фото: ${task.photoCount}`}>
          <CameraIcon size={11} className="shrink-0" />
          {task.photoCount}
        </span>
      ) : null}
      <StatusBadge status={task.status} className="mt-px" />
    </Link>
  );
}
