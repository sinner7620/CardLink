import React from "react"
import { LocateFixedIcon } from "lucide-react"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"

/**
 * v2.4 §5.3：五个只读工具的结构化用户视图（第五阶段抽取共享）。
 * - 工具卡片与证据抽屉共用同一组件（一处维护，两处渲染）；
 * - 原始 JSON 仅作为诊断折叠项（<details>），默认不展开，不与结构化内容混排；
 * - RecordCard 的「打开原始卡片」走 plugin.locateRecord（§5.4），来源失效显式降级。
 */

const LEVEL_TEXT = { 0: "不会", 1: "不熟", 2: "掌握" }

export function LevelBadge({ level }) {
  if (level === undefined || level === null) return <Badge variant="outline">无等级</Badge>
  return <Badge variant={level === 0 ? "destructive" : level === 1 ? "secondary" : "default"}>{LEVEL_TEXT[level] ?? "未知"}</Badge>
}

function kv(label, value) {
  return { label, value }
}

export function KeyValueGrid({ rows }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
      {rows.filter(Boolean).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function RecordCard({ record, compact, onPreview, onLocate, locateBusy, locateError, diagnostic = false, showAnswer = true }) {
  if (!record) return null
  const source = [record.sourceNotebookTitle, ...(record.sourcePathTitles || [])].filter(Boolean).join(" › ")
  const ocr = record.ocr || (record.ocrStatus ? { status: record.textStatus } : null)
  const labels = [...new Set([...(record.manualCategories || []), ...(record.customTags || [])])]
  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <LevelBadge level={record.level} />
        <strong className="text-xs">{record.sourceTitle || "未命名错题"}</strong>
        {record.favorite ? <Badge variant="outline">★ 收藏</Badge> : null}
        {record.reviewCompleted ? <Badge variant="secondary">已完成复习</Badge> : null}
      </div>
      {/* §12：recordId 是内部标识，只有诊断模式才显示。 */}
      <div className="text-[11px] text-muted-foreground">来源：{source || "—"}{diagnostic && record.recordId ? ` · ${record.recordId}` : ""}</div>
      {record.categoryPath?.length ? (
        <div className="text-[11px] text-muted-foreground">分类：{record.categoryPath.join(" › ")}</div>
      ) : null}
      {labels.length || record.reasonTags?.length ? (
        <div className="flex gap-1 flex-wrap">
          {labels.map((label) => <Badge key={`label-${label}`} variant="secondary">{label}</Badge>)}
          {(record.reasonTags || []).map((t) => <Badge key={`r-${t}`} variant="outline">{t}</Badge>)}
        </div>
      ) : null}
      {!compact && record.questionText ? (
        <div className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{record.questionText}</div>
      ) : null}
      {!compact && showAnswer && record.answerText ? (
        <div className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-24 overflow-y-auto">答案：{record.answerText}</div>
      ) : null}
      {!compact && ocr ? (
        <KeyValueGrid
          rows={[
            ["OCR 来源", ocr.origin === "manual" ? "用户手工修订" : ocr.origin === "ocr" ? "机器识别" : ocr.origin === "note" ? "笔记原文" : "无"],
            ["文本状态", ocr.status || record.textStatus || "missing"],
          ]}
        />
      ) : null}
      <KeyValueGrid
        rows={[
          ...(Number.isFinite(record.verifiedReviewCount) ? [["可核实复习次数", record.verifiedReviewCount]] : []),
          ...(Number.isFinite(record.reviewCount) ? [["复习状态", `第 ${record.reviewCount} 次 · ${record.reviewCompleted ? "已完成" : record.nextReviewAt ? `下次 ${new Date(record.nextReviewAt).toLocaleDateString()}` : "未排期"}`]] : []),
          ...(!compact ? [["答案绑定", record.answerNotebookId ? "已绑定" : "未绑定"]] : []),
        ]}
      />
      {onPreview && record.recordId ? (
        <Button size="xs" variant="outline" className="self-start" onClick={() => onPreview(record.recordId)}>预览原题</Button>
      ) : null}
      {!compact && onLocate ? (
        <div className="flex flex-col gap-1">
          <Button size="xs" variant="outline" className="self-start" onClick={() => onLocate(record.recordId)} disabled={locateBusy}>
            <LocateFixedIcon className="size-3.5" />打开原始卡片
          </Button>
          {locateError ? <p className="m-0 text-[10px] text-destructive break-all">{locateError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export function StatsTable({ stats }) {
  const rows = [
    ["错题总数", stats.totalRecords],
    ["来源可用", stats.availableRecords],
    ["等级 0/1/2/未知", `${stats.levelCounts?.["0"]} / ${stats.levelCounts?.["1"]} / ${stats.levelCounts?.["2"]} / ${stats.levelCounts?.unknown}`],
    ["应复习（Harness 口径）", stats.dueCount],
    ["已复习错题数", stats.reviewedRecordCount],
    ["复习动作数", stats.totalReviewActions ?? "—"],
    ["当前等级复习计数和（辅助）", stats.currentLevelReviewCountSum],
    ["统计时区", stats.params?.timezone ?? "—"],
    ["到期边界", stats.params?.dueBoundary ?? "—"],
  ]
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-border/50">
            <th className="text-left py-1 pr-3 font-normal text-muted-foreground w-1/2">{k}</th>
            <td className="py-1">{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function EventsList({ events }) {
  if (!events?.length) return <p className="text-[11px] text-muted-foreground m-0">无复习事件。</p>
  return (
    <ul className="flex flex-col gap-1 list-none m-0 p-0">
      {events.map((e, i) => (
        <li key={e.id || i} className="flex items-center gap-2 text-[11px] rounded-md bg-muted/40 px-2 py-1">
          <Badge variant={e.eventType === "mark" ? "secondary" : "outline"}>{e.eventType === "mark" ? "入册" : "复习"}</Badge>
          <span>{new Date(e.at).toLocaleString()}</span>
          <LevelBadge level={e.level} />
          {e.errorReason ? <span className="text-muted-foreground">错因：{e.errorReason.label || e.errorReason.key}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/** 原始 JSON：诊断折叠项（默认不展开，不与结构化内容混排）。 */
export function RawJson({ value, label = "原始 JSON（诊断）" }) {
  if (value === undefined || value === null) return null
  return (
    <details className="agentRawJson">
      <summary className="text-[10px] text-muted-foreground cursor-pointer select-none">{label}</summary>
      <pre className="text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-muted/30 rounded-md p-2 mt-1">{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

function WeakPointsView({ data }) {
  return (
    <div className="flex flex-col gap-1.5">
      {data.message ? <p className="text-[11px] text-muted-foreground m-0">{data.message}</p> : null}
      {(data.distribution || []).slice(0, 8).map((d) => (
        <div key={d.path?.join("/") || String(d)} className="flex items-center justify-between text-[11px] rounded-md bg-muted/40 px-2 py-1">
          <span>{(d.path || []).join(" › ")}</span>
          <span>{d.count}</span>
        </div>
      ))}
    </div>
  )
}

/** 工具结果 → 结构化视图分发（§9 五工具；未知工具仅在诊断模式回退 JSON）。 */
export function ToolBodyView({ toolName, data, onPreview, onLocate, locateBusy, locateError, raw, diagnostic = false }) {
  if (!data) {
    return diagnostic
      ? <RawJson value={raw} label="原始返回（诊断）" />
      : <p className="text-[11px] text-muted-foreground m-0">该工具结果暂无可视化内容。</p>
  }
  if (toolName === "getMistakeStats") return <StatsTable stats={data} />
  if (toolName === "getReviewHistory") return <EventsList events={data.events} />
  if (toolName === "getMistakeDetail") return <RecordCard record={data.record} onPreview={onPreview} onLocate={onLocate} locateBusy={locateBusy} locateError={locateError} diagnostic={diagnostic} />
  if (toolName === "queryMistakes") {
    return (
      <div className="flex flex-col gap-1.5">
        {data.reviewCoverage ? (
          <KeyValueGrid rows={[
            ["匹配题数", data.reviewCoverage.matchingRecords],
            ["有历史记录的题数", data.reviewCoverage.recordsWithHistory],
          ]} />
        ) : null}
        {(data.records || []).map((r) => <RecordCard key={r.recordId} record={r} compact onPreview={onPreview} diagnostic={diagnostic} />)}
        {!data.records?.length ? <p className="text-[11px] text-muted-foreground m-0">无匹配记录。</p> : null}
      </div>
    )
  }
  if (toolName === "listWeakPoints") return <WeakPointsView data={data} />
  return diagnostic
    ? <RawJson value={data} label="原始返回（诊断）" />
    : <p className="text-[11px] text-muted-foreground m-0">该工具结果暂无可视化内容。</p>
}

/** 工具包络 → 结构化视图（证据抽屉数据形态：envelope.data + toolName）。 */
export function ToolEnvelopeView({ toolName, envelope, onLocate, locateBusy, locateError, diagnostic = false }) {
  const data = envelope?.data
  return (
    <div className="flex flex-col gap-1.5">
      <ToolBodyView toolName={toolName} data={data} onLocate={onLocate} locateBusy={locateBusy} locateError={locateError} raw={envelope} diagnostic={diagnostic} />
    </div>
  )
}
