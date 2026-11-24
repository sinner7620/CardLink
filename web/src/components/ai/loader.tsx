import { Spinner } from "../ui/spinner"
import { cn } from "../../lib/harness-cn"

/**
 * AI Elements Loader（Harness 版）：运行状态的可读提示。
 * 只表达「正在做什么」，不伪造 token 级流式进度（JSB HTTPS 无 SSE 证据，§11.1）。
 */

export type LoaderProps = {
  text?: string
  className?: string
}

export const Loader = ({ text = "生成中", className }: LoaderProps) => (
  <span
    data-slot="loader"
    role="status"
    aria-live="polite"
    className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}
  >
    <Spinner className="size-3" />
    <span>{text}</span>
  </span>
)
