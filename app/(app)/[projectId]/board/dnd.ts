"use client";

import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useRef } from "react";

// Общие настройки drag-and-drop доски: дни недели, «Текущие заявки» и
// дополнительные списки (docs/architecture.md §7).

/**
 * Мышь — после сдвига на 6px, чтобы обычный клик по карточке открывал задачу.
 * Тач — после долгого нажатия, чтобы не мешать прокрутке страницы.
 * Клавиатура — пробелом: Enter на карточке-ссылке по-прежнему открывает задачу.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
}

export type DragItemData = { title?: string };

function titleOf(data: unknown): string {
  const title = (data as DragItemData | undefined)?.title;
  return title ? `«${title}»` : "Элемент";
}

export const BOARD_ACCESSIBILITY: {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
} = {
  screenReaderInstructions: {
    draggable:
      "Нажмите пробел, чтобы взять элемент. Перемещайте стрелками, пробелом или Enter — положите, Escape — отмена.",
  },
  announcements: {
    onDragStart: ({ active }) => `${titleOf(active.data.current)} взят.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.data.current)} над новым местом.` : `${titleOf(active.data.current)} вне списков.`,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(active.data.current)} перемещён.` : `Перемещение ${titleOf(active.data.current)} отменено.`,
    onDragCancel: ({ active }) => `Перемещение ${titleOf(active.data.current)} отменено.`,
  },
};

/**
 * Атрибуты для перетаскиваемой ссылки или строки с собственными контролами:
 * убираем role="button"/aria-pressed, чтобы не ломать семантику ссылки.
 */
export function dragAttributes(attributes: DraggableAttributes) {
  const rest: Partial<DraggableAttributes> = { ...attributes };
  delete rest.role;
  delete rest["aria-pressed"];
  return rest;
}

/**
 * Клавиатурная активация срабатывает только на самом элементе: пробел в
 * чекбоксе или кнопке внутри строки не должен начинать перетаскивание.
 */
export function dragListeners(listeners: DraggableSyntheticListeners) {
  if (!listeners) return {};
  const { onKeyDown, ...rest } = listeners;
  return {
    ...rest,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.target === event.currentTarget) onKeyDown?.(event);
    },
  };
}

/**
 * После отпускания перетаскиваемой карточки браузер генерирует click — без
 * подавления он открыл бы задачу. Обработчики вешаются на обёртку DndContext.
 */
export function useSuppressClickAfterDrag() {
  const dragging = useRef(false);

  const onDragStart = useCallback(() => {
    dragging.current = true;
  }, []);

  const onDragFinish = useCallback(() => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (dragging.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return { onDragStart, onDragFinish, onClickCapture };
}
