"use client";

import { useSyncExternalStore } from "react";

// Открыт ли чат — запоминается в браузере по проекту, как раскрытая стопка
// «Сделано» (board/use-done-stack-open.ts). Хранилище может быть недоступно
// (приватное окно) — тогда состояние живёт в памяти вкладки.

const storageKey = (projectId: string) => `chat:open:${projectId}`;
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function readOpen(projectId: string): boolean {
  const cached = memory.get(projectId);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = window.localStorage.getItem(storageKey(projectId)) === "1";
  } catch {
    // Нет доступа к хранилищу — остаёмся свёрнутыми.
  }
  memory.set(projectId, value);
  return value;
}

function writeOpen(projectId: string, value: boolean) {
  memory.set(projectId, value);
  try {
    window.localStorage.setItem(storageKey(projectId), value ? "1" : "0");
  } catch {
    // Не сохранилось — останется в памяти вкладки.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatOpen(projectId: string): [boolean, (value: boolean) => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => readOpen(projectId),
    // На сервере и при гидратации панель свёрнута.
    () => false,
  );

  return [open, (value: boolean) => writeOpen(projectId, value)];
}
