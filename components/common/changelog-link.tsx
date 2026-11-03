"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { BellIcon } from "@/components/common/icons";
import {
  CHANGELOG_STORAGE_KEY,
  readSeenId,
  unseenChangelogCount,
} from "@/lib/business/changelog";

/** Что лежит в localStorage: id просмотренной записи или пустая строка. */
function readSeen(): string {
  try {
    return readSeenId(window.localStorage.getItem(CHANGELOG_STORAGE_KEY)) ?? "";
  } catch {
    // Приватный режим или запрет хранилища: считаем, что не видели ничего.
    return "";
  }
}

function subscribe(onChange: () => void): () => void {
  // Другая вкладка могла отметить «просмотрено» — обновляемся и здесь.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Ссылка «Что нового» в шапке с точкой, пока есть непросмотренные записи.
 *
 * Снимок читается через useSyncExternalStore, а не useState + useEffect: так
 * localStorage читается на клиенте, сервер отдаёт «точки нет», и гидратация
 * не расходится. Путь входит в снимок намеренно: шапка переживает переходы,
 * и без этого точка не погасла бы при возврате со страницы «Что нового».
 */
export function ChangelogLink() {
  const pathname = usePathname();
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${pathname}|${readSeen()}`,
    () => "server|",
  );
  const seen = snapshot.slice(snapshot.indexOf("|") + 1);
  const unseen = snapshot.startsWith("server|") ? 0 : unseenChangelogCount(readSeenId(seen));

  return (
    <Link
      href="/changelog"
      aria-label={unseen > 0 ? "Что нового, есть новые записи" : "Что нового"}
      className="relative rounded-md px-[9px] py-[5px] text-[13px] text-ink-muted transition-colors duration-120 hover:bg-page hover:text-ink"
    >
      {/* На узком экране шапка не помещается с текстом — остаётся иконка. */}
      <BellIcon size={14} className="sm:hidden" />
      <span className="hidden sm:inline">Что нового</span>
      {unseen > 0 ? (
        <span
          role="img"
          aria-label="Есть новые записи"
          className="absolute top-0.5 right-0.5 size-2 rounded-full bg-status-alert-fg"
        />
      ) : null}
    </Link>
  );
}
