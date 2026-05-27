import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-0 active:scale-[0.985]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
        "icon-sm": "size-7 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
