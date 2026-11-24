import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * shadcn/ui Alert（registry 复制式）。
 * Harness 页面用它承载「保存成功/连接失败/运行出错/隐私说明」四类反馈，
 * 统一 role（status/alert）由调用方按语义指定。
 */
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-md border p-2 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-2 [&>svg]:size-4 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        info: "border-border bg-muted/50 text-foreground",
        warning: "border-warning/30 bg-warning/5 text-warning",
        destructive:
          "border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive",
        success:
          "border-[color-mix(in_srgb,var(--mn-level-2,#248a3d)_45%,transparent)] bg-[color-mix(in_srgb,var(--mn-level-2,#248a3d)_8%,transparent)] text-[var(--mn-level-2,#248a3d)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-xs leading-relaxed text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
