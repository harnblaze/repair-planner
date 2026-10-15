"use client";

import { Menu } from "@base-ui/react/menu";
import { useState } from "react";

import { ArrowRightIcon, CheckIcon, ChevronDownIcon, PlusIcon, UndoIcon, UserIcon } from "@/components/common/icons";
import { BADGE_BASE, STATUS_CLASSES, STATUS_DOT_CLASSES } from "@/components/common/status-badge";
import { executorsInitials } from "@/lib/business/executor-names";
import { TASK_STATUSES, taskStatusLabel, type TaskStatus } from "@/lib/business/task-status";
import { cn } from "@/lib/utils";

import { CHIP_EXECUTORS_VISIBLE } from "./task-chip";
import type { TaskExecutor } from "./task-updates";

// Меню быстрой правки на карточке дня (docs/redesign.md «Быстрая правка с доски»).
// Кнопки лежат поверх растянутой ссылки карточки (task-chip.tsx): z-10 — чтобы
// нажатие не открывало заявку, а перетаскивание не начиналось.

export type DirectoryExecutor = TaskExecutor & { position: string | null; isActive: boolean };

const POPUP_CLASS =
  "max-h-(--available-height) min-w-[208px] origin-(--transform-origin) overflow-y-auto rounded-[7px] border border-line-strong bg-popover p-1 text-popover-foreground shadow-md outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

// На сенсорном экране строки выше — по ним попадают пальцем.
const ITEM_CLASS =
  "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none select-none data-highlighted:bg-row-hover [@media(pointer:coarse)]:py-2.5";

const HINT_CLASS = "ml-auto pl-3 font-mono text-[10.5px] text-meta-dim";

function Popup({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler }) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50">
        <Menu.Popup className={POPUP_CLASS} onKeyDown={onKeyDown}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

/**
 * Бейдж статуса-кнопка: меню всех шести статусов (цифры 1–6 выбирают сразу),
 * под чертой — перенос на следующий рабочий день и его отмена, если доступны
 * (lib/business/task-planning.ts: canCarryOverFromBoard, canUndoCarryOverFromBoard).
 */
export function StatusMenu({
  status,
  onChange,
  onCarryOver,
  onUndoCarryOver,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  /** null — переносить нельзя. */
  onCarryOver: (() => void) | null;
  /** null — отменять нечего. */
  onUndoCarryOver: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const label = taskStatusLabel(status);

  const choose = (next: TaskStatus) => {
    setOpen(false);
    if (next !== status) onChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < TASK_STATUSES.length) {
      event.preventDefault();
      choose(TASK_STATUSES[index].value);
    }
  };

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        aria-label={`Статус: ${label}. Изменить`}
        className={cn(
          BADGE_BASE,
          STATUS_CLASSES[status],
          "group/status relative z-10 inline-flex cursor-pointer items-center gap-[3px] transition-[filter] duration-120 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand data-[popup-open]:brightness-95",
        )}
      >
        <span className="truncate">{label}</span>
        {/* Стрелка — подсказка, что бейдж нажимается: на компьютере при наведении
            на карточку, на телефоне всегда. */}
        <ChevronDownIcon
          size={9}
          className="-mr-px hidden shrink-0 opacity-70 group-hover:inline group-focus-visible/status:inline group-data-[popup-open]/status:inline [@media(hover:none)]:inline"
        />
      </Menu.Trigger>
      <Popup onKeyDown={onKeyDown}>
        <Menu.RadioGroup value={status} onValueChange={(value) => choose(value as TaskStatus)}>
          {TASK_STATUSES.map((s, i) => (
            <Menu.RadioItem key={s.value} value={s.value} closeOnClick className={ITEM_CLASS}>
              <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_CLASSES[s.value])} />
              {s.label}
              {s.value === status ? (
                <CheckIcon size={13} className="ml-auto pl-px text-ink" />
              ) : (
                <kbd className={HINT_CLASS}>{i + 1}</kbd>
              )}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        {onCarryOver || onUndoCarryOver ? <Menu.Separator className="-mx-1 my-1 h-px bg-line-subtle" /> : null}
        {onCarryOver ? (
          <Menu.Item className={ITEM_CLASS} onClick={onCarryOver}>
            <ArrowRightIcon size={13} className="shrink-0 text-meta" />
            Перенести на следующий рабочий день
          </Menu.Item>
        ) : null}
        {onUndoCarryOver ? (
          <Menu.Item className={ITEM_CLASS} onClick={onUndoCarryOver}>
            <UndoIcon size={13} className="shrink-0 text-meta" />
            Отменить перенос
          </Menu.Item>
        ) : null}
      </Popup>
    </Menu.Root>
  );
}

/**
 * Строка исполнителей карточки: «Иванов И., Петров П., Сидоров С.» или
 * «Назначить» — видна всегда, чтобы заявка без исполнителей сразу бросалась
 * в глаза. Галочки сохраняются по одной, меню не закрывается.
 */
export function ExecutorsMenu({
  assigned,
  directory,
  onToggle,
}: {
  assigned: TaskExecutor[];
  directory: DirectoryExecutor[];
  onToggle: (executor: TaskExecutor, assign: boolean) => void;
}) {
  const assignedIds = new Set(assigned.map((e) => e.id));
  // Неактивных не предлагаем, но уже назначенных показываем — чтобы их можно было снять.
  const options = directory.filter((e) => e.isActive || assignedIds.has(e.id));
  const empty = assigned.length === 0;
  const fullNames = assigned.map((e) => e.name).join(", ");

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={empty ? "Назначить исполнителей" : `Исполнители: ${fullNames}. Изменить`}
        title={empty ? undefined : fullNames}
        // -mx-1 px-1: иконка стоит по одной линии с цехом-заказчиком выше, а
        // подсветка при наведении выходит чуть за текст.
        className={cn(
          "relative z-10 -mx-1 flex max-w-[calc(100%+0.5rem)] cursor-pointer items-start gap-1 self-start rounded-[4px] px-1 py-px text-left text-[11.5px] transition-colors duration-120 hover:bg-row-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-brand data-[popup-open]:bg-row-hover",
          empty ? "text-meta-dim" : "text-meta",
        )}
      >
        {empty ? (
          <PlusIcon size={10} className="mt-[3px] shrink-0" />
        ) : (
          <UserIcon size={11} className="mt-[2px] shrink-0" />
        )}
        <span>
          {empty ? "Назначить" : executorsInitials(assigned.map((e) => e.name), CHIP_EXECUTORS_VISIBLE)}
        </span>
      </Menu.Trigger>
      <Popup>
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-meta">Нет активных исполнителей</p>
        ) : (
          options.map((executor) => {
            const checked = assignedIds.has(executor.id);
            return (
              <Menu.CheckboxItem
                key={executor.id}
                checked={checked}
                onCheckedChange={(next) => onToggle({ id: executor.id, name: executor.name }, next)}
                closeOnClick={false}
                className={ITEM_CLASS}
              >
                <span
                  className={cn(
                    "flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border",
                    checked ? "border-brand bg-brand text-white" : "border-control bg-surface",
                  )}
                >
                  {checked ? <CheckIcon size={11} strokeWidth={2} /> : null}
                </span>
                <span className="truncate">{executor.name}</span>
                {executor.position || !executor.isActive ? (
                  <span className="ml-auto truncate pl-3 text-[11.5px] text-meta">
                    {executor.isActive ? executor.position : "неактивен"}
                  </span>
                ) : null}
              </Menu.CheckboxItem>
            );
          })
        )}
      </Popup>
    </Menu.Root>
  );
}
