import { useEffect, useMemo, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
// ── dsh-context (Apache-2.0) 实际源码移植：见 web/src/vendor/dsh-context/NOTICE.md ──
import { CAT_COLOR } from "@/vendor/dsh-context/categories"
import { occupancyPercent } from "@/vendor/dsh-context/headline"
import { makeKit } from "@/vendor/dsh-context/kit"
import { makeCurrentComposition } from "@/vendor/dsh-context/currentComposition"
import { makeLegend, makeStackedBar } from "@/vendor/dsh-context/stackedBar"
import { makeTrendChart } from "@/vendor/dsh-context/trendChart"
import "@/vendor/dsh-context/styles/base.css"
import "@/vendor/dsh-context/styles/stats.css"
import "@/vendor/dsh-context/styles/stackedBar.css"
import "@/vendor/dsh-context/styles/trendChart.css"
import "@/vendor/dsh-context/styles/cardlink.css"
// ── dsh-cost-meter (MIT) 实际源码移植：见 web/src/vendor/dsh-cost-meter/NOTICE.md ──
import { Card, Cards, CostTable } from "@/vendor/dsh-cost-meter/card"
import "@/vendor/dsh-cost-meter/styles/cost.css"
import "@/vendor/dsh-cost-meter/styles/cardlink.css"
import "./context-insights.css"

/**
 * v2.14 §22：AI 对话「上下文」面板（上游 UI 移植版）。
 *
 * 布局、标记与样式来自两个上游项目的真实界面源码，不在本文件重新设计视觉：
 *  - 当前上下文构成条 / 图例：dsh-context `currentComposition.tsx` + `stackedBar.tsx`
 *    + `stackedBar.css`（含 lc-card / lc-overview-num / lc-legend / lc-chip）；
 *  - 上下文趋势：dsh-context `trendChart.tsx` 的图形与标记（拆离版，见 vendor 注释）
 *    + `trendChart.css`；
 *  - 费用卡片与按日表：dsh-cost-meter `Card` 渲染器与 `HistoryTable` 日期行骨架
 *    + 其内联 `.cm-*` 样式。
 *
 * 本文件只做四件适配（其余保持上游）：
 *  1. H1 遥测 props → 上游 `Headline` / `parts` / `TrendPoint`；
 *  2. 中文分项名（键与颜色仍来自上游 CATS）；
 *  3. 主题变量桥（vendor 下的 styles/cardlink.css）与深色开关；
 *  4. 外层可展开容器（现有进入点）+ 极少量外壳样式（context-insights.css）。
 */

/** H1 六项分项 → 上游分类键（键与颜色不改，仅标签按 H1 口径命名）。 */
const H1_PARTS = [
  ["system", "instructionTokens", "系统指令"],
  ["tools", "toolDefinitionTokens", "工具定义"],
  ["user", "messageTokens", "会话消息"],
  ["inject", "compactionTokens", "压缩摘要"],
  ["tool", "toolResultTokens", "工具结果"],
  ["skill", "overheadTokens", "结构开销"],
]

const H1_CAT_LABEL = Object.fromEntries(H1_PARTS.map(([key, , label]) => [key, label]))

const kit = makeKit({ catLabel: (key) => H1_CAT_LABEL[key] ?? key })
const StackedBar = makeStackedBar(kit)
const Legend = makeLegend(kit)
const CurrentComposition = makeCurrentComposition(kit, StackedBar, Legend)
const TrendChart = makeTrendChart(kit)

const COMPACTION_STATUS_LABELS = {
  none: "无需压缩",
  reused: "已复用历史摘要",
  compacted: "本轮已压缩",
  insufficient: "上下文预算不足",
}

const OUTCOME_LABELS = {
  delivered: "已送达",
  failed: "失败",
  cancelled: "已取消",
  not_sent: "未发送",
  sent: "已发送·未确认",
}

const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€", JPY: "JP¥", HKD: "HK$" }

function formatTokens(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "—"
}

function formatMoney(amount, currency) {
  if (!Number.isFinite(amount)) return "—"
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `
  const digits = amount > 0 && amount < 1 ? 4 : 2
  return `${symbol}${amount.toFixed(digits)}`
}

function bucketAmountText(buckets) {
  const list = (buckets ?? []).filter((bucket) => bucket.amount !== null || bucket.requests > 0)
  if (!list.length) return "—"
  return list
    .map((bucket) => (bucket.amount === null ? `${bucket.currency ?? "未配置费率"} 金额未知` : formatMoney(bucket.amount, bucket.currency)))
    .join(" · ")
}

function bucketCoverageText(buckets) {
  const list = buckets ?? []
  if (!list.length) return "暂无可计价请求"
  const requests = list.reduce((sum, bucket) => sum + (bucket.requests ?? 0), 0)
  const priced = list.reduce((sum, bucket) => sum + (bucket.pricedRequests ?? 0), 0)
  const unpriced = list.reduce((sum, bucket) => sum + (bucket.unpricedRequests ?? 0), 0)
  const missing = list.reduce((sum, bucket) => sum + (bucket.missingUsageRequests ?? 0), 0)
  const parts = [`可计价 ${priced}/${requests}`]
  if (unpriced > 0) parts.push(`无费率 ${unpriced}`)
  if (missing > 0) parts.push(`用量缺失 ${missing}`)
  return parts.join(" · ")
}

/** 深色开关：与插件缓存页同一套取值，由容器类切换 vendor 变量桥。 */
function useDarkScheme() {
  const [dark, setDark] = useState(() => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches === true)
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setDark(query.matches)
    query.addEventListener?.("change", onChange)
    return () => query.removeEventListener?.("change", onChange)
  }, [])
  return dark
}

/** H1 遥测行 → 上游 parts（键/颜色不变）与窗口/预留几何。 */
/** H1 遥测行 → 上游 parts（键/颜色不变）与窗口/预留几何。 */
function geometryOf(breakdown, budget) {
  // 只渲染 H1 实际有的六项（键与颜色仍取自上游 CAT_COLOR），不出现恒为 0 的 assistant 分类。
  const parts = H1_PARTS.map(([key, field]) => ({
    key,
    color: CAT_COLOR[key],
    value: Number(breakdown?.[field]) || 0,
  }))
  const output = Number(budget?.outputBudgetTokens) || 0
  const headroom = Number(budget?.reservedTokens) || 0
  const input = Number(budget?.inputBudgetTokens) || 0
  // 窗口 C = 输入预算 + 输出预留 + 安全余量（遥测按 B_input = C − O − R 记录）。
  const window = input > 0 ? input + output + headroom : 0
  const threshold = Number(budget?.compactionTriggerTokens) || 0
  const reserve = window > 0 ? { threshold, headroom, output } : undefined
  return { parts, window, reserve }
}

function RequestFacts({ item }) {
  const facts = [
    ["输入预算", formatTokens(item.budget?.inputBudgetTokens)],
    ["输出预留", formatTokens(item.budget?.outputBudgetTokens)],
    ["安全余量", formatTokens(item.budget?.reservedTokens)],
    ["压缩阈值", formatTokens(item.budget?.compactionTriggerTokens)],
    ["prompt", `${formatTokens(item.tokens?.prompt)}（${sourceLabel(item.tokens?.promptSource)}）`],
    ["completion", `${formatTokens(item.tokens?.completion)}（${sourceLabel(item.tokens?.completionSource)}）`],
    ["单次费用", item.cost ? formatMoney(item.cost.amount, item.cost.currency) : "金额未知"],
  ]
  if (item.finishReason) facts.push(["终止原因", item.finishReason])
  if (item.errorCode) facts.push(["错误", item.errorCode])
  if (item.compaction?.id) facts.push(["压缩记录", item.compaction.applied ? "本轮新建" : "复用摘要"])
  return (
    <div className="lc-pi-grid">
      {facts.map(([label, value]) => (
        <div className="lc-pi-row" key={label}>
          <span className="lc-pi-label">{label}</span>
          <span className="lc-pi-value">{value}</span>
        </div>
      ))}
    </div>
  )
}

function sourceLabel(source) {
  if (source === "provider") return "服务商实报"
  if (source === "estimated") return "估算"
  return "缺失"
}

export function ContextInsights({ chat, defaultOpen = false }) {
  const { contextUsage, insights, insightsState, insightsError, refreshInsights, loadOlderInsights, activeSessionId } = chat
  const [open, setOpen] = useState(defaultOpen)
  const [hoverKey, setHoverKey] = useState(null)
  const [selectedSeq, setSelectedSeq] = useState(null)
  const [hoveredSeq, setHoveredSeq] = useState(null)
  const dark = useDarkScheme()

  // 切换会话时清空柱状选中与联动高亮（上游在会话切换时同样复位）。
  useEffect(() => {
    setSelectedSeq(null)
    setHoveredSeq(null)
    setHoverKey(null)
  }, [activeSessionId])

  const requests = insights?.requests ?? []
  // 遥测按最新在前返回；趋势图按时间序绘制（上游 trendChart 也是这样取 requests）。
  const chrono = useMemo(() => [...requests].reverse(), [requests])
  const latest = chrono.length ? chrono[chrono.length - 1] : null

  const selected = selectedSeq === null ? latest : chrono[selectedSeq - 1] ?? latest
  const selectedGeometry = useMemo(
    () => (selected ? geometryOf(selected.breakdown, selected.budget) : null),
    [selected],
  )
  const head = useMemo(() => {
    if (!selected || !selectedGeometry) return null
    const tokens = Number(selected.breakdown?.totalTokens) || 0
    return {
      tokens,
      window: selectedGeometry.window > 0 ? selectedGeometry.window : undefined,
      pct: selectedGeometry.window > 0 ? occupancyPercent(tokens, selectedGeometry.window) : null,
      parts: selectedGeometry.parts,
      ...(selectedGeometry.reserve !== undefined ? { reserve: selectedGeometry.reserve } : {}),
    }
  }, [selected, selectedGeometry])

  const trendPoints = useMemo(() => {
    let runIndex = 0
    let lastRun = null
    let runStep = 0
    return chrono.map((item, index) => {
      if (item.runId !== lastRun) {
        lastRun = item.runId
        runIndex += 1
        runStep = 0
      }
      runStep += 1
      const { parts } = geometryOf(item.breakdown, item.budget)
      const time = new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      return {
        seq: index + 1,
        total: Number(item.breakdown?.totalTokens) || 0,
        parts,
        compaction: item.compaction?.applied === true,
        runKey: item.runId,
        runIndex,
        runStep,
        headText: `第 ${runIndex} 轮 · 第 ${runStep} 次请求（#${item.requestSeq}）`,
        metaText: `${time} · ${item.model} · ${OUTCOME_LABELS[item.outcome] ?? item.outcome}`,
      }
    })
  }, [chrono])

  const todayText = bucketAmountText(insights?.cost?.today)
  const sessionText = bucketAmountText(insights?.cost?.session)
  // 近期合计：按币种合并按日分桶（不同币种不混算）。上游卡片同样按口径分组展示。
  const recentBuckets = useMemo(() => {
    const merged = new Map()
    for (const day of insights?.cost?.days ?? []) {
      for (const bucket of day.buckets ?? []) {
        const key = bucket.currency ?? "__unpriced"
        const current = merged.get(key) ?? {
          currency: bucket.currency, amount: null, requests: 0, pricedRequests: 0, unpricedRequests: 0, missingUsageRequests: 0,
        }
        current.requests += bucket.requests ?? 0
        current.pricedRequests += bucket.pricedRequests ?? 0
        current.unpricedRequests += bucket.unpricedRequests ?? 0
        current.missingUsageRequests += bucket.missingUsageRequests ?? 0
        if (bucket.amount !== null) current.amount = Math.round(((current.amount ?? 0) + bucket.amount) * 1e6) / 1e6
        merged.set(key, current)
      }
    }
    return [...merged.values()]
  }, [insights])
  const recentText = bucketAmountText(recentBuckets)
  const dayRows = useMemo(() => {
    const days = insights?.cost?.days ?? []
    return [...days].reverse().map((day) => {
      const requestsInDay = day.buckets.reduce((sum, bucket) => sum + (bucket.requests ?? 0), 0)
      const priced = day.buckets.reduce((sum, bucket) => sum + (bucket.pricedRequests ?? 0), 0)
      const missing = day.buckets.reduce((sum, bucket) => sum + (bucket.missingUsageRequests ?? 0), 0)
      return {
        key: day.date,
        label: day.date,
        cells: [String(requestsInDay), String(priced), String(missing), bucketAmountText(day.buckets)],
      }
    })
  }, [insights])

  if (!contextUsage && !insights && insightsState !== "loading") return null

  const loading = insightsState === "loading" && !insights
  const hasRequests = chrono.length > 0

  return (
    <Collapsible className="w-full" onOpenChange={setOpen} open={open}>
      <div className="agentContextBar" data-slot="context-usage">
        <div className="agentContextSummary">
          {contextUsage?.context ? (
            <span>
              有效上下文 {formatTokens(contextUsage.context.estimatedInputTokens)} / {formatTokens(contextUsage.context.inputBudgetTokens)} Token（估算）
            </span>
          ) : (
            <span>本轮尚无上下文用量</span>
          )}
          {Number.isFinite(contextUsage?.context?.compactionTriggerTokens) ? (
            <span>压缩阈值 {formatTokens(contextUsage.context.compactionTriggerTokens)} Token</span>
          ) : null}
          {contextUsage?.context?.compactionStatus ? (
            <span>{COMPACTION_STATUS_LABELS[contextUsage.context.compactionStatus]}</span>
          ) : null}
          {contextUsage?.usage?.totalTokens ? (
            <span>
              本轮总用量 {formatTokens(contextUsage.usage.totalTokens)} Token
              {contextUsage.usage.estimated ? "（估算）" : "（服务商实报）"}
            </span>
          ) : null}
          {contextUsage ? <span>累计压缩 {contextUsage.compactionCount} 次</span> : null}
          {!contextUsage && insights ? <span>已记录 {formatTokens(insights.requestCount)} 次请求</span> : null}
        </div>
        <CollapsibleTrigger asChild>
          <Button
            aria-label={open ? "收起上下文详情" : "展开上下文详情"}
            className="agentContextToggle"
            size="sm"
            type="button"
            variant="ghost"
          >
            上下文详情
            <ChevronDownIcon className={open ? "agentContextChevron open" : "agentContextChevron"} />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className={`lc-cardlink cm-cardlink${dark ? " lc-dark cm-dark" : ""}`} data-slot="context-insights">
          {insightsState === "error" ? (
            <div className="lc-error" role="alert">
              <span className="lc-error-msg">{insightsError || "上下文数据读取失败"}</span>
              <button className="lc-error-retry" type="button" onClick={() => { void refreshInsights(activeSessionId) }}>
                重试
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="lc-card">
              <div className="lc-card-title">
                <span className="lc-card-title-text">{kit.t("overview.title")}</span>
              </div>
              <div className="lc-skel-rows" role="status" aria-label="正在读取">
                <span className="lc-skel-bar" />
                <span className="lc-skel-bar" />
                <span className="lc-skel-bar" />
              </div>
              <div className="lc-skel-plot" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => <span className="lc-skel-bar" key={index} />)}
              </div>
            </div>
          ) : null}

          {!loading && insights && !hasRequests ? (
            <div className="lc-card">
              <div className="lc-card-title">
                <span className="lc-card-title-text">{kit.t("overview.title")}</span>
              </div>
              <p className="lc-empty">{kit.t("trend.empty")}</p>
            </div>
          ) : null}

          {!loading && hasRequests && head ? (
            <>
              <CurrentComposition
                head={head}
                hoverKey={hoverKey}
                onHoverKey={setHoverKey}
                subtitle={selected ? `${selected.model} · ${OUTCOME_LABELS[selected.outcome] ?? selected.outcome}` : undefined}
              />

              <div className="lc-card">
                <div className="lc-card-title">
                  <span className="lc-card-title-text">
                    {kit.t("trend.title")}
                  </span>
                  <span className="lc-card-sub">点击柱子查看该次请求的构成</span>
                </div>
                <TrendChart
                  focusCat={hoverKey}
                  hoveredSeq={hoveredSeq}
                  onHover={setHoveredSeq}
                  onSelect={setSelectedSeq}
                  points={trendPoints}
                  selectedSeq={selectedSeq}
                />
                <div className="lc-card-sub" style={{ marginLeft: 0, marginTop: 6 }}>
                  ✂ 表示该次请求新建了历史压缩摘要；轮次行按会话内发起顺序编号。
                </div>
              </div>

              {selected ? (
                <div className="lc-card">
                  <div className="lc-card-title">
                    <span className="lc-card-title-text">
                      {`第 ${selected.requestSeq} 次请求 · ${OUTCOME_LABELS[selected.outcome] ?? selected.outcome}`}
                    </span>
                    <span className="lc-card-sub">{new Date(selected.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <RequestFacts item={selected} />
                  <div style={{ marginTop: 10 }}>
                    <StackedBar
                      height={14}
                      hoverKey={hoverKey}
                      max={head.window}
                      onHoverKey={setHoverKey}
                      parts={selectedGeometry?.parts ?? head.parts}
                      reserve={selectedGeometry?.reserve}
                    />
                    <Legend
                      hoverKey={hoverKey}
                      onHoverKey={setHoverKey}
                      parts={selectedGeometry?.parts ?? head.parts}
                    />
                  </div>
                </div>
              ) : null}

              <div className="lc-card">
                <div className="lc-card-title">
                  <span className="lc-card-title-text">费用估算</span>
                  <span className="lc-card-sub">
                    {`近 ${insights.cost?.days?.length ?? 0} 天 · ${insights.timezone ?? ""}`.trim()}
                  </span>
                </div>
                <Cards>
                  <Card title="本会话" sub={bucketCoverageText(insights.cost?.session)} value={sessionText} />
                  <Card title="今日" sub={bucketCoverageText(insights.cost?.today)} value={todayText} />
                  <Card
                    title="近期合计"
                    sub={`按请求时间本地日历聚合 · ${bucketCoverageText(recentBuckets)}`}
                    value={recentText}
                  />
                </Cards>

                {dayRows.length ? (
                  <div style={{ marginTop: 12 }}>
                    <CostTable head={["日期", "请求", "可计价", "用量缺失", "估算费用"]} rows={dayRows} />
                  </div>
                ) : null}
                <p className="lc-foot">
                  按每次请求当时保存的 provider + model 费率快照本地估算，不联网取价；仅统计 Assistant 请求
                  （不含审核调用），未计缓存折扣、额度或余额。历史请求缺少明细时不回填。
                </p>
                <button
                  className="cm-btn small"
                  disabled={insights.hasMore !== true}
                  onClick={() => { void loadOlderInsights() }}
                  type="button"
                >
                  {insights.hasMore ? "加载更早的请求" : "已显示全部可用请求"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
