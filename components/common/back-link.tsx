"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { INITIAL_NAVIGATION, recordNavigation } from "@/lib/navigation-history";

// Живёт, пока открыта вкладка: при полной перезагрузке начинается заново,
// как и история переходов внутри приложения.
let navigation = INITIAL_NAVIGATION;

/** Запоминает переходы между страницами приложения. Ставится один раз в общий layout. */
export function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    navigation = recordNavigation(navigation, pathname);
  }, [pathname]);

  return null;
}

/**
 * «← Назад»: возвращает туда, откуда пришли (доска нужной недели, список
 * заявок, история материала). Если пришли не из приложения — на fallbackHref.
 */
export function BackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <Link
      href={fallbackHref}
      onClick={(event) => {
        if (navigation.hasInAppHistory) {
          event.preventDefault();
          router.back();
        }
      }}
      className="self-start text-[12.5px] text-meta hover:text-ink"
    >
      ← Назад
    </Link>
  );
}
