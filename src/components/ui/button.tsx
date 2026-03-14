import { ComponentPropsWithoutRef, forwardRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2, CheckCircle2 } from "lucide-react"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-400 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary-500 text-white shadow hover:bg-primary-500/90 hover:shadow-md",
        destructive:
          "bg-rose-500 text-white shadow-sm hover:bg-rose-500/90",
        outline:
          "border border-border-muted bg-transparent shadow-sm hover:bg-bg-subtle hover:text-text-main",
        secondary:
          "bg-bg-elevated text-text-main shadow-sm hover:bg-bg-elevated/80",
        ghost: "hover:bg-bg-subtle hover:text-text-main",
        link: "text-primary-500 underline-offset-4 hover:underline",
        "primary-gradient": "bg-gradient-to-br from-primary-500 to-indigo-600 text-white shadow-lg shadow-primary-500/25 hover:opacity-90 active:scale-[0.98] transition-all",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  success?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, success, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(
          buttonVariants({ variant, size, className }),
          "button-active-scale",
          loading && "btn-loading",
          success && "btn-success"
        )}
        disabled={loading || disabled || success}
        ref={ref}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" size={16} />}
        {success && <CheckCircle2 size={16} />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
