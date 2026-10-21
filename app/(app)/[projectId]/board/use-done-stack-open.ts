"use client";

import { useSyncExternalStore } from "react";

import { rememberOpenDay } from "./day-stack";

// Раскрытая стопка «Сделано» запоминается в браузере (localStorage) по
// проекту: список дат. Хранилище может быть недоступно (приватное окно) —
// тогда состояние живёт в памяти вкладки, кнопка работает как раньше.

const storageKey = (projectId: string) => `repair-planner:done-stack-open:${projectId}`;
const memory = new Map<string, string[]>();
const listeners = new Set<() => void>();

function readDays(projectId: string): string[] {
  const cached = memory.get(projectId);
  if (cached) return cached;
  let days: string[] = [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "[]");
    if (Array.isArray(parsed)) days = parsed.filter((d): d is string => typeof d === "string");
  } catch {
    // Нет доступа или испорченное значение — начинаем с пустого списка.
  }
  memory.set(projectId, days);
  return days;
}

function writeDays(projectId: string, days: string[]) {
  memory.set(projectId, days);
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(days));
  } catch {
    // Не сохранилось — остаётся в памяти вкладки.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDoneStackOpen(projectId: string, date: string): [boolean, () => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => readDays(projectId).includes(date),
    // На сервере и при гидратации стопка свёрнута, как раньше.
    () => false,
  );
  const toggle = () => writeDays(projectId, rememberOpenDay(readDays(projectId), date, !open));
  return [open, toggle];
}
