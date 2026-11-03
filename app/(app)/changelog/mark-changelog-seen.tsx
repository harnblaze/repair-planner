"use client";

import { useEffect } from "react";

import { CHANGELOG_STORAGE_KEY, latestChangelogId } from "@/lib/business/changelog";

/**
 * Отметка «просмотрено»: страница «Что нового» открыта — значит всё, что в
 * списке, увидено. Пишем только id, без состояния: шапка читает localStorage
 * сама, когда путь меняется.
 */
export function MarkChangelogSeen() {
  useEffect(() => {
    const id = latestChangelogId();
    if (!id) return;
    try {
      window.localStorage.setItem(CHANGELOG_STORAGE_KEY, id);
    } catch {
      // Запрет хранилища не должен ломать страницу: просто не запомним.
    }
  }, []);

  return null;
}
