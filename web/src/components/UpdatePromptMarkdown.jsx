import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * 更新确认弹窗专用的 Markdown 渲染。
 *
 * 与 AI 回答的 Response 分开：Release 正文是外部内容，只允许 GFM 基础格式，
 * 不经过 AI 数学预处理，也不开放 AI 回答里的 card:/stat: 引用按钮语义。
 *
 * 安全边界：
 * - `skipHtml`：原始 HTML 节点直接丢弃（不转义成可见文本、更不产生元素）。
 * - 链接只接受能用 `new URL` 解析且协议为 http:/https: 的绝对地址；协议相对（//host）、
 *   普通相对路径、mailto:、card:/stat: 以及无效值一律只显示文字，不生成 href，
 *   也没有可点击/按钮语义。
 * - 图片不产生 `<img>`：只把 alt（缺省时用地址）作为普通文字显示，因此不会发起任何资源请求。
 * - 不需要 `rehype-raw`，也不使用 `dangerouslySetInnerHTML`。
 */

const UNSAFE_PROTOCOL = /^(?:mailto|tel|javascript|data|file|blob|card|stat):/i

/** 只有绝对 http(s) 地址返回可用的 href；其余返回空串。 */
export function safeUpdateLinkTarget(href) {
  if (typeof href !== "string") return ""
  const value = href.trim()
  if (!value) return ""
  // 协议相对（//host/…）没有基准可依，无法确认目标站点，按文字保留。
  if (value.startsWith("//")) return ""
  // 先按协议前缀拒绝常见危险/非网页协议，再用 URL 校验绝对地址。
  if (UNSAFE_PROTOCOL.test(value)) return ""
  let url
  try {
    url = new URL(value)
  } catch {
    return ""
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return ""
  if (!url.hostname) return ""
  return url.href
}

function MarkdownLink({ href, children, node, ...props }) {
  const target = safeUpdateLinkTarget(href)
  if (target) {
    return (
      <a
        data-slot="md-link"
        {...props}
        className="updatePromptLink"
        href={target}
        rel="noopener noreferrer nofollow"
        target="_blank"
        title={target}
      >
        {children}
      </a>
    )
  }
  // 不可安全解析的链接：只保留文字，去掉 href，避免同帧导航或伪按钮语义。
  return <span data-slot="md-link-text">{children}</span>
}

function MarkdownImage({ src, alt }) {
  const label = typeof alt === "string" && alt.trim() ? alt.trim() : ""
  const address = typeof src === "string" && src.trim() ? `（${src.trim()}）` : ""
  return (
    <span data-slot="md-image" className="updatePromptImage">
      {`${label || "图片"}${address}`}
    </span>
  )
}

function MarkdownTable({ children, node, ...props }) {
  return (
    <div className="mdTableScroll" {...props}>
      <table>{children}</table>
    </div>
  )
}

export function UpdatePromptMarkdown({ content, className }) {
  const text = typeof content === "string" ? content : ""
  return (
    <div data-slot="update-prompt-markdown" className={["updatePromptMarkdown", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={url => safeUpdateLinkTarget(url)}
        components={{ a: MarkdownLink, img: MarkdownImage, table: MarkdownTable }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
