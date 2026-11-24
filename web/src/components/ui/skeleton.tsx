import * as React from "react"
import { cn } from "@/lib/utils"

/** shadcn/ui Skeleton：加载态占位（AI 数据报告首次读取统计时使用）。 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
