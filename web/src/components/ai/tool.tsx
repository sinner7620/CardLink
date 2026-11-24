import { Badge } from "../ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible"
import { cn } from "../../lib/harness-cn"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { isValidElement } from "react"

/**
 * AI Elements Tool（registry 结构与 API + Harness 适配）。
 * 来源：https://registry.ai-sdk.dev/tool.json
 *
 * 与官方的差异（均有意为之，逐条可核对）：
 * - 状态文案中文、状态色改用插件令牌（--mn-level-*），不用 Tailwind 调色板字面量；
 * - 额外提供审核标记（已审核 / 免审），满足 §10.1「免审调用不得冒充已审核」；
 * - CodeBlock 使用本地轻量实现（官方 code-block 依赖 shiki，插件包不引高亮引擎）；
 * - 不引 tw-animate-css，因此动画类改为 CSS transition。
 */

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error"

type ToolUIPart = {
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}

export type ToolPart = ToolUIPart & { toolName?: string; type?: string }

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    data-slot="tool"
    className={cn("group/tool not-prose w-full rounded-md border bg-card", className)}
    {...props}
  />
)

/** §10.1 审核标记：tier_skip 的调用只能标「免审」，绝不能标「已审核」。 */
export type AuditMark = "approved" | "skipped" | undefined

export type ToolHeaderProps = {
  /** 官方 API：无 title 时从 type 推导工具名（如 "tool-queryMistakes" → "queryMistakes"）。 */
  type?: string
  title?: string
  state: ToolState
  audit?: AuditMark
  /** 审核拒绝原因等附加说明。 */
  note?: string
  className?: string
}

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "等待审核",
  "approval-responded": "已批准",
  "input-available": "执行中",
  "input-streaming": "准备中",
  "output-available": "已执行",
  "output-denied": "审核拒绝",
  "output-error": "执行失败",
}

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-3.5 toolStatusIcon toolStatusIcon-pending" />,
  "approval-responded": <CheckCircleIcon className="size-3.5 toolStatusIcon toolStatusIcon-ok" />,
  "input-available": <ClockIcon className="size-3.5 animate-pulse toolStatusIcon toolStatusIcon-pending" />,
  "input-streaming": <CircleIcon className="size-3.5 toolStatusIcon toolStatusIcon-pending" />,
  "output-available": <CheckCircleIcon className="size-3.5 toolStatusIcon toolStatusIcon-ok" />,
  "output-denied": <XCircleIcon className="size-3.5 toolStatusIcon toolStatusIcon-denied" />,
  "output-error": <XCircleIcon className="size-3.5 toolStatusIcon toolStatusIcon-error" />,
}

function StatusBadge({ state }: { state: ToolState }) {
  return (
    <Badge variant="secondary" className="gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium">
      {statusIcons[state]}
      {statusLabels[state]}
    </Badge>
  )
}

function AuditBadge({ audit }: { audit: AuditMark }) {
  if (!audit) return null
  const skipped = audit === "skipped"
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium",
        skipped ? "border-dashed text-muted-foreground" : "text-[var(--mn-level-2,#248a3d)]"
      )}
      title={skipped ? "按会话审核档位免审（未经模型审核者复核）" : "已由模型审核者复核批准"}
    >
      {skipped ? <ShieldOffIcon className="size-3" /> : <ShieldCheckIcon className="size-3" />}
      {skipped ? "免审" : "已审核"}
    </Badge>
  )
}

export const ToolHeader = ({ className, title, type, state, audit, note, ...props }: ToolHeaderProps) => {
  const derived = type ? type.split("-").slice(1).join("-") : ""
  const name = title || derived || "工具调用"
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md p-2.5 text-left transition-colors hover:bg-accent/50",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs font-medium">{name}</span>
        <StatusBadge state={state} />
        <AuditBadge audit={audit} />
        {note ? <span className="text-[10px] text-muted-foreground">{note}</span> : null}
      </div>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      // 同 SourcesContent：自带 flex 会覆盖 UA 的 [hidden] 规则，折叠时必须显式隐藏。
      "flex flex-col gap-2.5 border-t p-2.5 text-foreground data-[state=closed]:hidden",
      className
    )}
    {...props}
  />
)

/** 轻量代码块：纯文本 + 等宽字体，不引 shiki/高亮引擎。 */
export function CodeBlock({ code, language, className }: { code: string; language?: string; className?: string }) {
  return (
    <pre className={cn("m-0 max-h-56 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed", className)}>
      <code data-language={language}>{code}</code>
    </pre>
  )
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"]
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const empty = input === undefined || input === null || (typeof input === "object" && Object.keys(input as Record<string, unknown>).length === 0)
  return (
    <div className={cn("flex flex-col gap-1.5 overflow-hidden", className)} {...props}>
      <h4 className="m-0 text-[10px] font-medium tracking-wide text-muted-foreground">参数</h4>
      {empty ? <p className="m-0 text-[11px] text-muted-foreground">无参数</p> : <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />}
    </div>
  )
}

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"]
  errorText?: string
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) return null

  let body: ReactNode
  if (errorText) body = null
  else if (typeof output === "string") body = <CodeBlock code={output} language="text" />
  else if (isValidElement(output)) body = output
  else if (typeof output === "object") body = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
  else body = <div className="text-[11px]">{String(output)}</div>

  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <h4 className="m-0 text-[10px] font-medium tracking-wide text-muted-foreground">{errorText ? "错误" : "结果"}</h4>
      <div className={cn("overflow-x-auto rounded-md text-xs", errorText ? "bg-destructive/10 p-2 text-destructive" : "bg-muted/40 p-2 text-foreground")}>
        {errorText ? <div className="text-[11px] break-all">{errorText}</div> : body}
      </div>
    </div>
  )
}
