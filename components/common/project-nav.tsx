"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// Порядок пунктов зафиксирован дизайном (docs/redesign.md §2).
const SECTIONS = [
  { segment: "board", label: "Доска" },
  { segment: "tasks", label: "Заявки" },
  { segment: "categories", label: "Категории" },
  { segment: "executors", label: "Исполнители" },
  { segment: "materials", label: "Материалы" },
  { segment: "reports", label: "Отчёты" },
  { segment: "settings", label: "Настройки" },
] as const;

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // На узком экране пункты не помещаются и листаются внутри полосы —
  // активный пункт прокручиваем к центру, чтобы он не оказался за краем.
  // На широком экране полоса не прокручивается и присваивание ничего не меняет.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="relative -mx-5 flex min-w-0 items-center gap-0.5 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:shrink-0 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map(({ segment, label }) => {
        const href = `/${projectId}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-[11px] py-1.5 text-[13px] transition-colors duration-120",
              active
                ? "bg-brand-surface font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-brand-line)]"
                : "text-ink-nav hover:bg-[#F3F5F8] hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
