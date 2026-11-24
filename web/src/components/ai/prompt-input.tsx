import * as React from "react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { cn } from "../../lib/harness-cn"

/**
 * AI Elements PromptInput（裁剪版，§3.1）。
 * 保留官方组件形态：表单 + 自增高输入区 + 工具栏 + 圆形提交按钮；
 * 剥离附件/截图/引用源/模型选择等 H1 未用能力（H1 不向模型发送文件）。
 * 额外修正：文本状态由受控 ref 与 hasText 双轨维护，提交按钮在空文本时禁用。
 */

type ChatStatus = "ready" | "submitted" | "streaming" | "error"

type PromptInputContextValue = {
  status: ChatStatus
  onStop?: () => void
  textRef: React.MutableRefObject<string>
  hasText: boolean
  setHasText: (value: boolean) => void
}

const PromptInputContext = React.createContext<PromptInputContextValue>({
  status: "ready",
  textRef: { current: "" },
  hasText: false,
  setHasText: () => {},
})

function usePromptInput() {
  return React.useContext(PromptInputContext)
}

export type PromptInputMessage = { text: string }

export type PromptInputProps = Omit<React.HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  status?: ChatStatus
  onStop?: () => void
  onSubmit: (message: PromptInputMessage, event: React.FormEvent<HTMLFormElement>) => void | Promise<void>
}

function PromptInput({ className, status = "ready", onStop, onSubmit, children, ...props }: PromptInputProps) {
  const textRef = React.useRef("")
  const [hasText, setHasText] = React.useState(false)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status === "submitted" || status === "streaming") return
    const text = textRef.current
    if (!text.trim()) return
    textRef.current = ""
    setHasText(false)
    const textarea = event.currentTarget.querySelector("textarea")
    if (textarea) {
      textarea.value = ""
      textarea.style.height = "auto"
    }
    void onSubmit({ text }, event)
  }

  return (
    <PromptInputContext.Provider value={{ status, onStop, textRef, hasText, setHasText }}>
      <form
        data-slot="prompt-input"
        className={cn(
          "w-full overflow-hidden rounded-xl border border-input bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
          className
        )}
        onSubmit={handleSubmit}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  )
}

export type PromptInputTextareaProps = React.ComponentProps<"textarea">

function PromptInputTextarea({
  className,
  onKeyDown,
  onChange,
  placeholder = "输入问题…",
  ...props
}: PromptInputTextareaProps) {
  const { status, textRef, setHasText } = usePromptInput()
  const [isComposing, setIsComposing] = React.useState(false)
  const busy = status === "submitted" || status === "streaming"

  const sync = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
    textRef.current = el.value
    setHasText(Boolean(el.value.trim()))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key !== "Enter") return
    // 输入法组合中的 Enter 是选词，不是发送
    if (isComposing || event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    const form = event.currentTarget.form
    const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null
    if (submitButton?.disabled) return
    form?.requestSubmit()
  }

  return (
    <textarea
      rows={1}
      placeholder={placeholder}
      data-slot="prompt-input-textarea"
      className={cn(
        "min-h-[44px] w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-70",
        className
      )}
      ref={(el) => {
        if (!el || el.value) return
        el.style.height = "auto"
        el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 168)}px`
      }}
      onChange={(event) => {
        onChange?.(event)
        sync(event.currentTarget)
      }}
      onKeyDown={(event) => {
        setIsComposing(false)
        handleKeyDown(event)
      }}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={(event) => {
        setIsComposing(false)
        sync(event.currentTarget)
      }}
      disabled={busy}
      {...props}
    />
  )
}

export type PromptInputToolbarProps = React.ComponentProps<"div">

function PromptInputToolbar({ className, ...props }: PromptInputToolbarProps) {
  return <div data-slot="prompt-input-toolbar" className={cn("flex items-center justify-between gap-2 px-2 pt-0.5 pb-2", className)} {...props} />
}

/** AI Elements PromptInputTools / PromptInputFooter（vercel/chatbot 版 API 的等价包装）。 */
export type PromptInputToolsProps = React.ComponentProps<"div">

function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
  return <div data-slot="prompt-input-tools" className={cn("flex items-center gap-1", className)} {...props} />
}

export type PromptInputFooterProps = React.ComponentProps<"div">

function PromptInputFooter({ className, ...props }: PromptInputFooterProps) {
  return <div data-slot="prompt-input-footer" className={cn("flex items-center justify-between gap-2", className)} {...props} />
}

export type PromptInputButtonProps = React.ComponentProps<"button">

function PromptInputButton({ className, ...props }: PromptInputButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export type PromptInputSubmitProps = React.ComponentProps<"button"> & {
  status?: ChatStatus
  onStop?: () => void
}

function PromptInputSubmit({ className, status = "ready", onStop, onClick, disabled, ...props }: PromptInputSubmitProps) {
  const context = usePromptInput()
  const effectiveStatus = status ?? context.status
  const generating = effectiveStatus === "submitted" || effectiveStatus === "streaming"
  const stop = generating ? onStop ?? context.onStop : undefined
  const blocked = generating ? !stop : !context.hasText

  return (
    <button
      type={generating ? "button" : "submit"}
      aria-label={generating ? "停止生成" : "发送"}
      title={generating ? "停止生成" : "发送（Enter）"}
      disabled={disabled || blocked}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground",
        className
      )}
      onClick={(event) => {
        if (generating && stop) {
          event.preventDefault()
          stop()
          return
        }
        onClick?.(event)
      }}
      {...props}
    >
      {generating ? <SquareIcon className="size-3.5" /> : <ArrowUpIcon className="size-4" />}
    </button>
  )
}

export { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputButton, PromptInputSubmit, PromptInputTools, PromptInputFooter }
