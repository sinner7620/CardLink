import * as React from "react"
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "../../lib/harness-cn"
import { Action, Actions } from "./actions"

/**
 * v2.4 §5.1 消息操作栏（AI Elements Actions/Action 组合）。
 * - 复制：WKWebView 的 clipboard 需在用户手势栈内同步调用（assistant-ui 源码验证的约束），
 *   先走 navigator.clipboard，失败回退 execCommand("copy")；
 * - 重新生成：以持久化的"重新生成"用户请求发起新一轮（存储为追加式、无分支树，
 *   不做历史改写——分支语义留待后续规范修订）；仅对最后一条助手消息提供；
 * - 查看引用来源：由 AnswerPresenter 的来源折叠列表承担，不在此重复。
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand("copy")
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}

export type MessageActionsProps = {
  text: string
  /** 提供时显示「重新生成」（仅最后一条助手消息）。 */
  onRegenerate?: () => void
  className?: string
}

export function MessageActions({ text, onRegenerate, className }: MessageActionsProps) {
  const [copied, setCopied] = React.useState(false)
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout>>()
  React.useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  const copy = React.useCallback(() => {
    void copyTextToClipboard(text).then((ok) => {
      setCopied(ok)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <Actions className={cn("agentMessageActions", className)}>
      <Action tooltip={copied ? "已复制" : "复制消息"} onClick={copy}>
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </Action>
      {onRegenerate ? (
        <Action tooltip="重新生成回答" onClick={onRegenerate}>
          <RefreshCwIcon className="size-3.5" />
        </Action>
      ) : null}
    </Actions>
  )
}
