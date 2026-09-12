import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[30px] w-full min-w-0 rounded-[7px] border border-control bg-surface px-2.5 text-[12.5px] text-ink transition-[border-color,box-shadow] duration-120 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium file:text-ink placeholder:text-placeholder hover:border-control-hover focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-page disabled:text-faint aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
        className
      )}
      {...props}
    />
  )
}

export { Input }
