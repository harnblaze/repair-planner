"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { countNewActivityAction } from "@/app/(app)/[projectId]/activity/actions";
import { activitySeenKey } from "@/lib/business/activity-seen";
import { cn } from "@/lib/utils";

// Порядок пунктов зафиксирован дизайном (docs/redesign.md §2).
const SECTIONS = [
  { segment: "board", label: "Доска" },
  { segment: "tasks", label: "Заявки" },
  { segment: "categories", label: "Категории" },
  { segment: "executors", label: "Исполнители" },
  { segment: "materials", label: "Материалы" },
  { segment: "supply", label: "Снабжение" },
  { segment: "reports", label: "Отчёты" },
  { segment: "activity", label: "Лента" },
  { segment: "settings", label: "Настройки" },
] as const;

/** Метка «читали до» из localStorage; null — читали неизвестно когда. */
function readSeen(projectId: string): string | null {
  try {
    return window.localStorage.getItem(activitySeenKey(projectId));
  } catch {
    return null;
  }
}

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Сколько записей ленты появилось после последнего визита. Сервер про это
  // не знает (метка живёт в браузере), поэтому на сервере бейджа нет, а на
  // клиенте он появляется после ответа — так гидратация не расходится.
  const [newInActivity, setNewInActivity] = useState(0);

  const activityHref = `/${projectId}/activity`;
  const onActivity = pathname === activityHref || pathname.startsWith(`${activityHref}/`);

  // На узком экране пункты не помещаются и листаются внутри полосы —
  // активный пункт прокручиваем к центру, чтобы он не оказался за краем.
  // На широком экране полоса не прокручивается и присваивание ничего не меняет.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }, [pathname]);

  // Пересчёт при монтировании и на каждом переходе. Опрос по таймеру не
  // делаем: бейдж — это «что накопилось, пока меня не было», а не счётчик в
  // реальном времени, и лишние запросы на каждой странице ни к чему.
  useEffect(() => {
    let cancelled = false;
    countNewActivityAction(projectId, readSeen(projectId))
      .then((count) => {
        if (!cancelled) setNewInActivity(count);
      })
      .catch(() => {
        if (!cancelled) setNewInActivity(0);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pathname]);

  return (
    <nav
      ref={navRef}
      className="relative -mx-5 flex min-w-0 items-center gap-0.5 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:shrink-0 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map(({ segment, label }) => {
        const href = `/${projectId}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        // На самой ленте бейдж не нужен: записи уже перед глазами.
        const badge = segment === "activity" && !onActivity ? newInActivity : 0;

        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={badge > 0 ? `${label}, новых записей: ${badge}` : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-[11px] py-2 text-[13px] whitespace-nowrap transition-colors duration-120 sm:py-1.5",
              active
                ? "bg-brand-surface font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-brand-line)]"
                : "text-ink-nav hover:bg-[#F3F5F8] hover:text-ink",
            )}
          >
            {label}
            {badge > 0 ? (
              // Мельче, чем бейдж в чате: строка навигации не должна раздуваться.
              <span
                aria-hidden
                className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-status-alert-fg px-1 text-[10px] leading-[14px] font-semibold tabular-nums text-white"
              >
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
