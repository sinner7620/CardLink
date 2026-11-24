import * as React from "react"
import { cn } from "../../lib/harness-cn"

/**
 * AI Elements Actions / Action（registry 结构 + Harness 样式）。
 * 消息下方的哑组件操作栏：具体行为由调用方通过 onClick 注入，
 * 组件本身不持有 runtime 假设（与 assistant-ui 的哑组件路线一致）。
 */

export type ActionsProps = React.ComponentProps<"div">

export const Actions = ({ className, ...props }: ActionsProps) => (
  <div
    data-slot="actions"
    role="toolbar"
    aria-label="消息操作"
    className={cn("agentMessageActions flex items-center gap-0.5", className)}
    {...props}
  />
)

export type ActionProps = React.ComponentProps<"button"> & {
  /** 可见文字（可选；仅有图标时用 tooltip 提供无障碍名称）。 */
  label?: string
  /** 无障碍名称与悬停提示。不得传入内部 ID。 */
  tooltip?: string
}

export const Action = ({ label, tooltip, className, children, ...props }: ActionProps) => (
  <button
    {...props}
    type="button"
    data-slot="action"
    title={tooltip ?? label}
    aria-label={tooltip ?? label}
    className={cn("agentMessageAction", className)}
  >
    {children}
    {label ? <span className="agentMessageActionLabel">{label}</span> : null}
  </button>
)
