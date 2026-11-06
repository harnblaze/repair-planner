"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  type ResolvedTheme,
  type ThemeChoice,
  applyTheme,
  readSystemDark,
  readThemeChoice,
  resolveTheme,
} from "@/lib/theme/theme";

// Тема как внешнее хранилище: источник правды — localStorage и системная
// настройка. Компоненты (кнопка в шапке и выбор в профиле) подписаны на одни
// и те же события, поэтому переключение в одном месте сразу видно в другом.

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener("planner:theme-changed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("planner:theme-changed", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  systemDark: boolean;
} {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => "system" as ThemeChoice);
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => false);
  const resolved = resolveTheme(choice, systemDark);

  // Скрипт в <head> уже поставил класс до отрисовки; эффект догоняет изменения:
  // смену системной темы и выбор в другом окне.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  return { choice, resolved, systemDark };
}
