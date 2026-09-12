import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-transparent bg-clip-padding text-[12.5px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter,box-shadow] duration-120 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-brand/12 disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-white hover:brightness-[1.08] active:brightness-[0.94] focus-visible:border-brand disabled:bg-[#C8D0DE] disabled:text-white",
        outline:
          "border-control bg-surface text-ink-soft hover:bg-[#F4F6FA] hover:text-ink active:bg-[#EBEFF5] focus-visible:border-brand disabled:text-faint",
        secondary:
          "bg-page text-ink-soft hover:bg-[#E7EBF1] hover:text-ink focus-visible:border-brand disabled:text-faint",
        ghost:
          "font-medium text-ink-nav hover:bg-[#F3F5F8] hover:text-ink focus-visible:border-brand disabled:text-faint",
        destructive:
          "bg-status-alert-bg text-status-alert-fg hover:brightness-[0.97] focus-visible:border-destructive focus-visible:ring-destructive/15 disabled:opacity-60",
        link: "font-medium text-brand underline-offset-4 hover:underline disabled:text-faint",
      },
      size: {
        default: "h-[30px] gap-[5px] px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-[11px]",
        sm: "h-7 gap-1 px-2.5 text-[12px]",
        lg: "h-9 gap-1.5 px-3.5 text-[13px]",
        icon: "size-[30px]",
        "icon-xs": "size-6 rounded-md",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
