import { cn } from "@/lib/utils";

import { ChevronDownIcon } from "@/components/common/icons";

// Нативный <select> в оформлении контролов дизайна (docs/redesign.md §6, «Inputs / select»):
// собственная стрелка вместо системной, та же высота и фокус-кольцо, что у Input.
export const NATIVE_SELECT_CLASS =
  "h-[30px] w-full cursor-pointer appearance-none rounded-[7px] border border-control bg-surface pr-7 pl-2.5 text-[12.5px] text-ink-soft transition-[border-color,box-shadow] duration-120 outline-none hover:border-control-hover focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:pointer-events-none disabled:bg-page disabled:text-faint";

export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select className={cn(NATIVE_SELECT_CLASS, className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-2.5 right-2.5 text-meta-dim" />
    </span>
  );
}
