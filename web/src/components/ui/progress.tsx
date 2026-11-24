import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * 轻量 Progress（不引 radix，保持插件包体积）。
 * 用于 AI 数据报告的等级分布条：外层负责轨道，内层用 transform 表达进度。
 */
function Progress({
  value = 0,
  className,
  indicatorClassName,
  indicatorStyle,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value?: number
  indicatorClassName?: string
  indicatorStyle?: React.CSSProperties
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0))
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 rounded-full bg-primary", indicatorClassName)}
        style={{ transform: `translateX(-${100 - clamped}%)`, ...indicatorStyle }}
      />
    </div>
  )
}

export { Progress }
