import * as React from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "../../lib/rehype-code-highlight"
import { cn } from "../../lib/harness-cn"
import "katex16/dist/katex.min.css"

/**
 * AI Elements Response（§3.1 + v2.4 交互完善第三阶段）。
 *
 * 渲染管线：react-markdown 10 + remark-gfm 4（表格/删除线/任务列表）+ remark-math 6
 * （行内 $…$ 与块级 $$…$$）+ rehype-katex 7（KaTeX 0.16 同版本 CSS 经 katex16 别名引入）
 * + 工作台共用的代码围栏高亮。
 *
 * 安全边界（§12.5，研究结论实测）：
 * - 不引入 rehype-raw/rehype-sanitize：react-markdown 默认把原始 HTML 转义为文本、
 *   全程 React 节点构造（无 innerHTML）；defaultUrlTransform 仅放行 http(s)/mailto 等
 *   安全协议（javascript:/data: 的 href 被清空）。
 * - urlTransform 仅扩展放行 `card:` 前缀（引用协议，AnswerPresenter 消费），其余走默认。
 * - KaTeX trust 保持默认 false（\href/javascript 渲染为错误文本）；strict:ignore 避免告警刷屏。
 *
 * 预处理：LLM 常见变体归一化——\(…\)/\[…\] → $…$/$$…$$；整行 $$…$$ → 多行 flow math
 * （remark-math 的 display 要求 $$ 后换行，单行 $$ 归一化才能获得 katex-display 与横向滚动）。
 * 围栏代码块内不做替换。
 */

type InlineMathTransform = string

const FENCE = /^\s*(```|~~~)/

/** 数学定界符归一化（逐行，跳过围栏代码块）。 */
export function normalizeMathDelimiters(text: string): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let inFence = false
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    let l = line
    // \(…\) → $…$；\[…\] → $$…$$（同一行成对）
    l = l.replace(/\\\((.+?)\\\)/g, (_m, body: string) => `$${body}$`)
    l = l.replace(/\\\[(.+?)\\\]/g, (_m, body: string) => `$$${body}$$`)
    // 独立行 \[ / \] → $$ 围栏（多行 display 块）
    if (/^\s*\\\[\s*$/.test(l) || /^\s*\\\]\s*$/.test(l)) {
      out.push("$$")
      continue
    }
    // 整行 $$…$$ → 多行 flow math（单行 $$ 在 remark-math 里是 inline，会丢 display/滚动）
    const single = /^\s*\$\$(.+)\$\$\s*$/.exec(l)
    if (single) {
      out.push("$$", single[1].trim(), "$$")
      continue
    }
    out.push(l)
  }
  return out.join("\n")
}

/** 引用协议（v2.4 §10.1.1）：card:/stat: 前缀放行给 Citation 处理；其余维持默认白名单。 */
export function urlTransform(url: string): string {
  if (typeof url === "string" && (url.startsWith("card:") || url.startsWith("stat:"))) return url
  return defaultUrlTransform(url)
}

type CitationKind = "card" | "stat"

/** 可在系统浏览器/宿主中打开的协议（只放行 http(s) 与 mailto）。 */
const SAFE_EXTERNAL_URL = /^(https?:|mailto:)/i

/**
 * v2.4 §10.1.1 补强：
 * - card:/stat: 引用 → 行内按钮，点击经 onCitation 交给宿主（不产生可导航 href）；
 * - 安全外链（http/https/mailto）→ 真实 <a>，可长按复制、可在宿主允许时打开；
 * - 其余（相对路径、未知协议）→ 纯文本，不提供点击。
 */
function MarkdownLink({
  href,
  children,
  onCitation,
  onExternalLink,
  ...props
}: React.ComponentProps<"a"> & {
  onCitation?: (kind: CitationKind, id: string) => void
  onExternalLink?: (url: string) => void
}) {
  const kind: CitationKind | null = typeof href === "string" && href.startsWith("card:")
    ? "card"
    : typeof href === "string" && href.startsWith("stat:")
      ? "stat"
      : null
  const id = kind && typeof href === "string" ? href.slice(kind.length + 1) : ""

  if (!kind && typeof href === "string" && SAFE_EXTERNAL_URL.test(href)) {
    return (
      <a
        data-slot="md-link"
        {...props}
        className="text-primary underline decoration-primary/40 underline-offset-2 break-all"
        href={href}
        rel="noopener noreferrer nofollow"
        target="_blank"
        title={href}
        onClick={(event) => {
          // 宿主提供回调时接管打开（WebView 内默认导航通常被拦截）；否则交给系统默认行为。
          if (!onExternalLink) return
          event.preventDefault()
          onExternalLink(href)
        }}
      >
        {children}
      </a>
    )
  }

  return (
    <span
      data-slot="md-link"
      {...props}
      data-citation={kind ?? undefined}
      role={kind ? "button" : undefined}
      tabIndex={kind ? 0 : undefined}
      className={cn(
        "text-primary underline decoration-primary/40 underline-offset-2 break-all",
        kind && "agentCitationLink font-medium",
      )}
      // 引用链接的 href 含 recordId/statsId：不得写入 title（悬停会泄露内部标识）。
      title={kind ? undefined : href}
      onClick={kind ? () => onCitation?.(kind, id) : undefined}
      onKeyDown={kind ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCitation?.(kind, id) } } : undefined}
    >
      {children}
    </span>
  )
}

/** 表格包横向滚动容器（移动端长表）。 */
function MarkdownTable({ children, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="mdTableScroll" {...props}>
      <table>{children}</table>
    </div>
  )
}

export type ResponseProps = {
  content: string
  className?: string
  /** v2.4 §10.1.1：引用链接点击（card:recordId / stat:statsId）交给宿主处理。 */
  onCitation?: (kind: CitationKind, id: string) => void
  /** 可选：拦截安全外链的打开（未提供时使用 <a target="_blank"> 的默认行为）。 */
  onExternalLink?: (url: string) => void
}

export const Response = React.memo(function Response({ content, className, onCitation, onExternalLink }: ResponseProps) {
  const normalized = React.useMemo(() => normalizeMathDelimiters(content), [content])
  return (
    <div
      data-slot="response"
      className={cn("agentMarkdown flex min-w-0 flex-col gap-2 text-sm leading-relaxed break-words", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { strict: "ignore", output: "html", maxSize: 30 }],
          rehypeHighlight,
        ]}
        urlTransform={urlTransform}
        components={{
          a: (props) => <MarkdownLink {...props} onCitation={onCitation} onExternalLink={onExternalLink} />,
          table: MarkdownTable,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
})
