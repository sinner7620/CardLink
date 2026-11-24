import * as React from "react"
import { BookIcon, SigmaIcon } from "lucide-react"
import { cn } from "../../lib/harness-cn"
import { Response } from "./response"
import { Source, Sources, SourcesContent, SourcesTrigger } from "./sources"

/**
 * v2.4 §10.1.1 AnswerPresenter：AI 原始回答 → 用户可读展示层。
 * - 正文经 CitationResolver 重写后已是可读标题链接（card:/stat:），点击经 onCitation 回调
 *   打开证据抽屉 / 定位原始卡片；普通用户看不到内部 ID。
 * - 来源清单优先用本轮 CitationResolver 的 DTO（真实标题/分类/等级），重开会话时用
 *   harness.resolveRecordTitles 解析的标题映射兜底；无标题数据时才回退显示原引用串。
 * - 开发者诊断模式（内部 ID）不在此组件实现——回答正文已不含标记，原始文本留在审计层。
 */

export type CitationInfo = {
  type: "card" | "stat"
  ref?: string
  recordId?: string
  statsId?: string
  title?: string
  notebookTitle?: string
  level?: number | null
  available?: boolean
}

export type RecordTitleInfo = { available: boolean; title?: string; notebookTitle?: string; level?: number | null }

export type SourceItem = {
  key: string
  kind: "card" | "stat"
  id: string
  label: string
  sub?: string
  available: boolean
}

export function sourceItemsOf(
  message: { evidenceRefs?: unknown; citations?: unknown },
  titles?: Record<string, RecordTitleInfo>,
): SourceItem[] {
  const rawCitations = Array.isArray(message.citations) ? (message.citations as CitationInfo[]) : null
  if (rawCitations?.length) {
    return rawCitations.map((c, index) => c.type === "card"
      ? {
          key: `card-${c.recordId ?? index}`,
          kind: "card",
          id: c.recordId ?? "",
          label: c.available ? (c.title || "（标题缺失）") : "引用不可用",
          sub: c.available ? c.notebookTitle : undefined,
          available: c.available === true && Boolean(c.recordId),
        }
      : {
          key: `stat-${c.statsId ?? ""}-${index}`,
          kind: "stat",
          id: c.statsId ?? "",
          label: c.available ? (c.label || "统计来源") : "统计来源不可用",
          available: c.available === true && Boolean(c.statsId),
        })
  }
  const refs = Array.isArray(message.evidenceRefs) ? (message.evidenceRefs as string[]) : []
  return refs.map((ref) => {
    if (ref.startsWith("stat:ev_")) {
      return { key: ref, kind: "stat", id: ref.slice(5), label: "统计来源", available: true }
    }
    const info = titles?.[ref]
    return {
      key: ref,
      kind: "card",
      id: ref,
      // 普通用户不得看到 recordId：标题未解析时显示待解析占位，绝不回退为内部标识。
      label: info ? (info.available ? info.title || "（标题缺失）" : "引用不可用") : "来源待解析",
      sub: info?.available ? info.notebookTitle : undefined,
      available: info?.available === true,
    }
  })
}

export type AnswerPresenterProps = {
  text: string
  citations?: CitationInfo[]
  evidenceRefs?: string[]
  titles?: Record<string, RecordTitleInfo>
  onOpenRecord?: (recordId: string) => void
  onOpenStat?: (statsId: string) => void
  /** 点击了未经本轮核验的引用（正文里的 card:/stat: 链接不在有效引用集合内）。 */
  onRejectCitation?: (kind: "card" | "stat", id: string) => void
  className?: string
}

export function AnswerPresenter({
  text,
  citations,
  evidenceRefs,
  titles,
  onOpenRecord,
  onOpenStat,
  onRejectCitation,
  className,
}: AnswerPresenterProps) {
  /**
   * b19-2b：可点击引用只来自经过验证的集合——
   * 优先用本轮 CitationResolver 的 DTO（available !== false），
   * 无 DTO 的旧消息退回 evidenceRefs（同样只含本轮工具证据）。
   * 正文里的 card:/stat: 链接若不在集合内（模型编造或文本被篡改）一律不打开。
   */
  const allowed = React.useMemo(() => {
    const cards = new Set<string>()
    const stats = new Set<string>()
    if (Array.isArray(citations) && citations.length) {
      for (const item of citations) {
        if (item.type === "card" && item.available !== false && item.recordId) cards.add(item.recordId)
        if (item.type === "stat" && item.available !== false && item.statsId) stats.add(item.statsId)
      }
    }
    if (Array.isArray(evidenceRefs)) {
      for (const ref of evidenceRefs) {
        if (typeof ref !== "string") continue
        if (ref.startsWith("stat:ev_")) stats.add(ref.slice(5))
        else if (ref) cards.add(ref)
      }
    }
    return { cards, stats }
  }, [citations, evidenceRefs])

  const onCitation = React.useCallback((kind: "card" | "stat", id: string) => {
    const verified = kind === "card" ? allowed.cards.has(id) : allowed.stats.has(id)
    if (!verified) {
      onRejectCitation?.(kind, id)
      return
    }
    if (kind === "card") onOpenRecord?.(id)
    else onOpenStat?.(id)
  }, [allowed, onOpenRecord, onOpenStat, onRejectCitation])
  const items = React.useMemo(
    () => sourceItemsOf({ citations, evidenceRefs }, titles),
    [citations, evidenceRefs, titles],
  )
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Response content={text} onCitation={onCitation} />
      {items.length ? (
        <Sources defaultOpen={false}>
          <SourcesTrigger count={items.length} />
          <SourcesContent>
            {items.map((item) => {
              const Icon = item.kind === "stat" ? SigmaIcon : BookIcon
              const open = item.available && item.id
                ? () => (item.kind === "card" ? onOpenRecord?.(item.id) : onOpenStat?.(item.id))
                : undefined
              return (
                <Source
                  key={item.key}
                  title={item.label}
                  tone={item.kind === "stat" ? "stats" : "record"}
                  onOpen={open}
                  disabled={!open}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className={cn("block truncate font-medium", item.kind === "stat" && "font-mono")}>{item.label}</span>
                  {item.sub ? <span className="block truncate text-[10px] text-muted-foreground">{item.sub}</span> : null}
                </Source>
              )
            })}
          </SourcesContent>
        </Sources>
      ) : null}
    </div>
  )
}
