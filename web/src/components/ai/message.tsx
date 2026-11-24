import { cn } from "../../lib/harness-cn"
import type { HTMLAttributes } from "react"
import { memo } from "react"
import { SparklesIcon } from "lucide-react"
import { Response } from "./response"

/**
 * AI Elements Message（§3.1）。
 * 角色通过 data-from + 语义标签区分（不是只靠底色），助手回答走 Response 渲染。
 */

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    data-slot="message"
    data-from={from}
    aria-label={from === "user" ? "你的提问" : "AI 回答"}
    className={cn(
      "group flex w-full flex-col gap-1",
      from === "user" ? "is-user items-end" : "is-assistant items-stretch",
      className
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    data-slot="message-content"
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:max-w-[88%] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:bg-card group-[.is-user]:px-3.5 group-[.is-user]:py-2.5 group-[.is-user]:shadow-xs group-[.is-user]:text-foreground",
      "group-[.is-assistant]:max-w-full group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageAvatarProps = {
  from: "user" | "assistant"
  className?: string
}

export const MessageAvatar = ({ from, className }: MessageAvatarProps) => (
  <div
    data-slot="message-avatar"
    aria-hidden="true"
    className={cn(
      "flex size-6 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground",
      className
    )}
  >
    {from === "assistant" ? <SparklesIcon className="size-3.5" /> : <span className="text-[10px] font-medium">我</span>}
  </div>
)

export type MessageResponseProps = { content: string; className?: string }

/** 兼容入口：等价于 Response（AI Elements 的 MessageResponse 即 Markdown 渲染）。 */
export const MessageResponse = memo(({ content, className }: MessageResponseProps) => (
  <Response content={content} className={className} />
))

MessageResponse.displayName = "MessageResponse"
