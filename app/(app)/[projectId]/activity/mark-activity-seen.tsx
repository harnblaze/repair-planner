"use client";

import { useEffect } from "react";

import { activitySeenKey } from "@/lib/business/activity-seen";

/**
 * Отмечает ленту прочитанной: запоминает время самой свежей записи на странице.
 *
 * Почему время, а не «сколько показано»: лента подгружается порциями, и число
 * зависело бы от того, сколько человек долистал. Время — устойчивый якорь:
 * всё, что появится позже, снова станет новым.
 */
export function MarkActivitySeen({
  projectId,
  latestAt,
}: {
  projectId: string;
  /** created_at самой свежей записи на странице; null — лента пуста. */
  latestAt: string | null;
}) {
  useEffect(() => {
    try {
      // Пустая лента: запоминаем «сейчас», иначе бейдж считал бы всё новым
      // до бесконечности.
      window.localStorage.setItem(activitySeenKey(projectId), latestAt ?? new Date().toISOString());
    } catch {
      // Хранилище запрещено (приватный режим): бейдж будет пересчитываться от
      // окна в 30 дней. Не повод ломать страницу.
    }
  }, [projectId, latestAt]);

  return null;
}
