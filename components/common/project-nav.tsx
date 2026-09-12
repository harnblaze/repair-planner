"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Порядок пунктов зафиксирован дизайном (docs/redesign.md §2).
const SECTIONS = [
  { segment: "board", label: "Доска" },
  { segment: "tasks", label: "Заявки" },
  { segment: "categories", label: "Категории" },
  { segment: "executors", label: "Исполнители" },
  { segment: "materials", label: "Материалы" },
  { segment: "settings", label: "Настройки" },
] as const;

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5">
      {SECTIONS.map(({ segment, label }) => {
        const href = `/${projectId}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-[11px] py-1.5 text-[13px] transition-colors duration-120",
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
