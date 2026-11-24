import { DataTable } from "@/components/assistant-ui/elements/data-table"
import React, { useCallback, useEffect, useState } from "react"
import { ArrowRightIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"
import { harnessSend } from "./lib/harnessClient"
import { Button } from "./components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./components/ui/empty"
import { Progress } from "./components/ui/progress"
import { Skeleton } from "./components/ui/skeleton"
import { Spinner } from "./components/ui/spinner"
import { cn } from "./lib/harness-cn"

/**
 * §13 错题统计页（总览 · AI 数据报告）。
 * 只读快照口径的统计对照卡：总数 / 等级分布 / 应复习 / 复习指标 + 数据来源与口径。
 * 不替代插件原有统计卡片，也不写回任何错题（§8 口径由 StatisticsEngine 决定）。
 */

const LEVELS = [
  { key: "0", label: "不会", color: "var(--mn-level-0, #d70015)" },
  { key: "1", label: "不熟", color: "var(--mn-level-1, #b25000)" },
  { key: "2", label: "掌握", color: "var(--mn-level-2, #248a3d)" },
]

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function formatMoment(value) {
  const time = Date.parse(String(value ?? ""))
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—"
}

function Metric({ label, value, hint }) {
  return (
    <div className="agentReportMetric" data-slot="report-metric">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <strong className="text-lg leading-none font-semibold tabular-nums">{value ?? "—"}</strong>
      {hint ? <em className="text-[10px] not-italic text-muted-foreground">{hint}</em> : null}
    </div>
  )
}

export function HarnessSyncCard({ onOpenAgent, onOpenSettings }) {
  const [stats, setStats] = useState(null)
  const [freshness, setFreshness] = useState(null)
  const [state, setState] = useState({ loading: true, error: "", busy: false })
  const [notice, setNotice] = useState("")

  const loadFreshness = useCallback(async () => {
    const res = await harnessSend("harness.getDataFreshness")
    if (res?.ok && res.data) setFreshness(res.data)
    else setFreshness({ status: "unknown", reason: res?.error?.message || "无法判断本地数据新鲜度" })
  }, [])

  const loadStats = useCallback(async () => {
    const res = await harnessSend("harness.stats", {})
    if (res?.ok && res.data) {
      setStats(res.data)
      setState((prev) => ({ ...prev, loading: false, error: "" }))
    } else {
      setState((prev) => ({ ...prev, loading: false, error: res?.error?.message || "读取统计失败" }))
    }
    await loadFreshness()
  }, [loadFreshness])

  useEffect(() => { void loadStats() }, [loadStats])

  const sync = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true }))
    setNotice("")
    try {
      const res = await harnessSend("harness.syncSnapshot")
      if (res?.ok) {
        await loadStats()
        setNotice(`已同步 ${res.data?.recordCount ?? "—"} 条（新增 ${res.data?.inserted ?? 0}，更新 ${res.data?.updated ?? 0}）`)
      } else {
        setState((prev) => ({ ...prev, error: res?.error?.message || "同步失败" }))
      }
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setState((prev) => ({ ...prev, busy: false }))
    }
  }, [loadStats])

  const levelCounts = stats?.levelCounts || {}
  const total = num(stats?.totalRecords)
  const levelTotal = LEVELS.reduce((sum, level) => sum + (num(levelCounts[level.key]) ?? 0), 0)
  const unknownLevel = num(levelCounts.unknown) ?? 0
  const hasSnapshot = Boolean(stats?.snapshotId && stats.snapshotId !== "none")
  const freshnessStatus = freshness?.status || "unknown"
  const freshnessLabel = freshnessStatus === "current" ? "已同步" : freshnessStatus === "stale" ? "本地数据已更新" : "状态未知"

  return (
    <Card className="agentReport harness-ui gap-3 py-4" data-slot="ai-report-card">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <SparklesIcon className="size-3.5 text-primary" />
          AI 数据报告
        </CardTitle>
        <CardDescription className="text-[11px] leading-relaxed">
          只读快照口径，与插件统计同源；AI 分析读取这份数据，不会修改任何错题。
        </CardDescription>
        <CardAction>
          {hasSnapshot ? (
            <Button variant="outline" size="sm" disabled={state.busy} onClick={sync}>
              {state.busy ? <Spinner /> : <RefreshCwIcon />}
              重新同步
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4">
        {state.loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-4/5" />
          </div>
        ) : null}

        {!state.loading && state.error ? (
          <Alert variant="destructive">
            <AlertTitle>统计数据不可用</AlertTitle>
            <AlertDescription>
              <p className="m-0 break-all">{state.error}</p>
              <Button size="xs" variant="outline" className="mt-1" onClick={() => { setState((prev) => ({ ...prev, loading: true, error: "" })); void loadStats() }}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {!state.loading && !state.error && !hasSnapshot ? (
          <Empty className="border-dashed bg-muted/20 py-5">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
              <EmptyTitle>尚未同步错题快照</EmptyTitle>
              <EmptyDescription>
                同步后，AI 分析将基于同一份只读快照作答，统计口径与插件一致（到期=明天 0 点前需要复习且未完成）。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" disabled={state.busy} onClick={sync}>
                {state.busy ? <Spinner /> : <RefreshCwIcon />}
                同步错题快照
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {!state.loading && !state.error && hasSnapshot ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="错题总数" value={total} hint={num(stats.availableRecords) !== undefined ? `来源可用 ${num(stats.availableRecords)}` : undefined} />
              <Metric label="应复习" value={num(stats.dueCount)} hint="Harness 口径" />
              <Metric label="已复习错题" value={num(stats.reviewedRecordCount)} hint="有真实复习行为" />
            </div>

            <div className="agentReportLevels">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] font-medium">等级分布</span>
                <span className="text-[10px] text-muted-foreground">
                  {levelTotal} 条有等级{unknownLevel ? ` · ${unknownLevel} 条无等级` : ""}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {LEVELS.map((level) => {
                  const count = num(levelCounts[level.key]) ?? 0
                  const percent = levelTotal ? Math.round(count / levelTotal * 100) : 0
                  return (
                    <div key={level.key} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{level.label}</span>
                      <Progress
                        value={percent}
                        className="h-1.5 flex-1"
                        indicatorStyle={{ background: level.color }}
                        aria-label={`${level.label} ${count} 条`}
                      />
                      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {count} 条 · {percent}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {freshnessStatus === "stale" ? (
              <Alert data-slot="data-freshness-alert">
                <AlertTitle>本地错题数据已变化</AlertTitle>
                <AlertDescription>
                  <p className="m-0">同步后会生成新快照；已经开始的 AI 运行仍读取原快照，新的运行使用新版本。答案卡片正文的修改不会自动感知，需要同步刷新。</p>
                  <Button size="xs" variant="outline" className="mt-1" disabled={state.busy} onClick={sync}>同步新快照</Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <DataTable
              columns={[{ key: "label", label: "指标" }, { key: "value", label: "快照数据" }]}
              rows={[
                { label: "复习动作数", value: num(stats.totalReviewActions) ?? "—" },
                { label: "当前等级复习计数和（辅助）", value: num(stats.currentLevelReviewCountSum) ?? "—" },
                { label: "数据状态", value: freshnessLabel },
                { label: "数据时间", value: formatMoment(stats.dataAsOf) },
                { label: "快照", value: String(stats.snapshotId) },
              ]}
              rowKey="label"
              locale="zh-CN"
            />

            <p className="agentReportFootnote">
              口径：到期 = 下次复习时间早于 {formatMoment(stats.params?.dueBoundary)}
              （{stats.params?.timezone || "本机时区"}）且未完成复习；复习动作数与当前等级复习计数和不能互相替代。
            </p>
          </>
        ) : null}

        {notice ? <p className="m-0 text-[11px] text-muted-foreground" role="status">{notice}</p> : null}
      </CardContent>

      <CardFooter className="gap-2 px-4">
        {onOpenAgent ? (
          <Button size="sm" onClick={onOpenAgent} disabled={!hasSnapshot}>
            打开 AI 分析
            <ArrowRightIcon />
          </Button>
        ) : null}
        {onOpenSettings ? (
          <Button size="sm" variant="ghost" onClick={onOpenSettings}>
            模型与密钥设置
          </Button>
        ) : null}
        <span className={cn("ml-auto text-[10px] text-muted-foreground")}>只读 · 不写回错题</span>
      </CardFooter>
    </Card>
  )
}
