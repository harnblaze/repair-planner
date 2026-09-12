import { cn } from "@/lib/utils";

// Общая оболочка четырёх нижних панелей доски (docs/redesign.md §6).

export const PANEL_FORM_CLASS =
  "flex flex-col gap-2 border-b border-line-subtle px-2.5 py-2.5 xl:px-3.5 xl:py-3";

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-[10px] border border-line-strong bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-[7px] border-b border-line-subtle px-2.5 py-[11px] xl:px-3.5">
      <span className="flex shrink-0 text-icon">{icon}</span>
      <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
      {count ? (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-counter">{count}</span>
      ) : null}
    </div>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-3.5 text-[11.5px] text-faint xl:px-3.5">{children}</p>;
}
