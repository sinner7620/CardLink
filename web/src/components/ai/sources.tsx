import * as React from "react"
import { BookIcon, ChevronDownIcon, ChevronRightIcon, SigmaIcon } from "lucide-react"
import { cn } from "../../lib/harness-cn"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible"

/**
 * AI Elements Sources（registry 结构 + Harness 内容适配）。
 * 来源：https://registry.ai-sdk.dev/sources.json
 *
 * 官方 Source 是外链卡片（<a target="_blank">）；H1 的「来源」是只读证据引用
 * （recordId / 统计证据），点击打开证据抽屉而不是跳外网，因此 Source 在保留
 * href 分支的同时增加了 onOpen（按钮形态）。其余结构与类名沿用官方。
 */

export type SourcesProps = React.ComponentProps<typeof Collapsible>

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    data-slot="sources"
    className={cn("group/sources not-prose text-primary text-xs", className)}
    {...props}
  />
)

export type SourcesTriggerProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number
}

export const SourcesTrigger = ({ className, count, children, ...props }: SourcesTriggerProps) => (
  <CollapsibleTrigger
    data-slot="sources-trigger"
    className={cn(
      "flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="h-3.5 w-3.5 shrink-0" />
        <p className="m-0 font-medium">{`${count} 处证据引用`}</p>
        <ChevronDownIcon className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/sources:rotate-180" />
      </>
    )}
  </CollapsibleTrigger>
)

export type SourcesContentProps = React.ComponentProps<typeof CollapsibleContent>

export const SourcesContent = ({ className, ...props }: SourcesContentProps) => (
  <CollapsibleContent
    data-slot="sources-content"
    className={cn(
      // data-[state=closed]:hidden 是必要补充：本组件自身带 flex，会压过 UA 的 [hidden]{display:none}，
      // 折叠时只留一条 14px 的空边框。
      "mt-1.5 flex w-full flex-col gap-0.5 rounded-lg border px-1.5 py-1.5 data-[state=closed]:hidden",
      className
    )}
    {...props}
  />
)

export type SourceProps = Omit<React.ComponentProps<"a">, "title"> & {
  title: string
  /** 统计类证据（数字来自 getMistakeStats）换一个图标。 */
  tone?: "record" | "stats"
  /** 无外链时的只读按钮形态（打开证据抽屉）。 */
  onOpen?: () => void
}

export const Source = ({ href, title, children, className, tone = "record", onOpen, ...props }: SourceProps) => {
  const Icon = tone === "stats" ? SigmaIcon : BookIcon
  const body = children ?? (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="block truncate font-mono font-medium">{title}</span>
    </>
  )

  if (!href) {
    return (
      <button
        type="button"
        title={title}
        onClick={onOpen}
        disabled={!onOpen}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-70",
          className
        )}
      >
        {body}
        {onOpen ? <ChevronRightIcon className="ml-auto h-3 w-3 shrink-0" /> : null}
      </button>
    )
  }

  return (
    <a
      className={cn("flex items-center gap-2", className)}
      href={href}
      rel="noreferrer"
      target="_blank"
      title={title}
      {...props}
    >
      {body}
    </a>
  )
}
