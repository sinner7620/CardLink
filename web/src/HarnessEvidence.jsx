import { DataTable } from "@/components/assistant-ui/elements/data-table"
import React, { useCallback, useEffect, useState } from "react"
import { LocateFixedIcon } from "lucide-react"
import { harnessSend } from "./lib/harnessClient"
import { Button } from "./components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog"
import { KeyValueGrid, RecordCard, ToolEnvelopeView } from "./components/ai/tool-views"
import { CardPreview } from "./CardPreview"

/**
 * 卡片引用 / 证据详情（弹窗浮层）。
 * 组件全部为 shadcn：Dialog 负责浮层与焦点陷阱，Button 负责动作；
 * 卡片内容复用 components/ai/tool-views 的 RecordCard（不另写展示组件）。
 *
 * 数据只读来源：harness.getEvidence（证据行 + tool_calls 结果包络）或当前会话工具结果；
 * 动作：跳转原题（plugin.locateRecord）、查看答案（展开 RecordCard 的答案区块）。
 */

export { RecordCard, KeyValueGrid }

export function EvidencePanel({ evidenceId, recordId, sessionId, branchId, sessionMessages, onClose, diagnostic = false }) {
  const [state, setState] = useState({ loading: true, error: "", data: null, record: null })
  const [preview, setPreview] = useState({ loading: true, error: "", html: "", title: "" })
  const [previewRetry, setPreviewRetry] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [locateBusy, setLocateBusy] = useState(false)
  const [locateError, setLocateError] = useState("")

  useEffect(() => {
    let alive = true
    setState({ loading: true, error: "", data: null, record: null })
    setShowAnswer(false)
    setLocateError("")
    if (evidenceId) {
      harnessSend("harness.getEvidence", { evidenceId, sessionId, branchId }).then((res) => {
        if (!alive) return
        if (res?.ok) setState({ loading: false, error: "", data: res.data, record: null })
        else setState({ loading: false, error: res?.error?.message || "证据不存在", data: null, record: null })
      })
    } else if (recordId) {
      // 从当前会话已加载的工具结果里找该记录（数据同源，不额外请求）。
      const toolResults = (sessionMessages || []).filter((m) => m.type === "tool_result")
      let found = null
      for (const m of toolResults.reverse()) {
        const data = m.content?.data
        if (data?.record?.recordId === recordId) { found = { record: data.record }; break }
        const inPage = (data?.records || []).find((r) => r.recordId === recordId)
        if (inPage && !found) found = { record: inPage }
      }
      setState({ loading: false, error: "", data: null, record: found?.record ?? null })
    }
    return () => { alive = false }
  }, [evidenceId, recordId, sessionId, branchId, sessionMessages])

  useEffect(() => {
    if (!recordId) return
    let alive = true
    setPreview({ loading: true, error: "", html: "", title: "" })
    harnessSend("plugin.previewRecord", { recordId, sessionId }).then((res) => {
      if (!alive) return
      const html = res?.ok ? res.data?.questionHtml : ""
      setPreview({
        loading: false,
        html: html || "",
        title: res?.data?.title || "",
        error: html ? "" : res?.error?.message || "原题预览加载失败",
      })
    }).catch((error) => {
      if (alive) setPreview({ loading: false, error: error instanceof Error ? error.message : "原题预览加载失败", html: "", title: "" })
    })
    return () => { alive = false }
  }, [recordId, sessionId, previewRetry])

  // v2.4 §5.4：跳转 MarginNote 原始卡片（plugin.locateRecord，经典层导航 API）。
  const locateRecord = useCallback(async (targetId) => {
    setLocateBusy(true)
    setLocateError("")
    try {
      const res = await harnessSend("plugin.locateRecord", { recordId: targetId })
      if (res?.ok && !res.data?.message) { onClose?.(); return }
      setLocateError(res?.data?.message || res?.error?.message || "原始卡片不可访问")
    } catch (error) {
      setLocateError(error instanceof Error ? error.message : "原始卡片不可访问")
    } finally {
      setLocateBusy(false)
    }
  }, [onClose])

  const data = state.data
  const record = state.record
  const hasAnswer = Boolean(record?.answerText)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.() }}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recordId ? (preview.title || record?.sourceTitle || "错题卡片") : "证据详情"}</DialogTitle>
          <DialogDescription>
            {recordId
              ? "错题原题预览"
              : "工具调用产生的证据与结构化结果。"}
          </DialogDescription>
        </DialogHeader>

        {state.loading ? <p className="m-0 text-[11px] text-muted-foreground">加载中…</p> : null}

        {state.error ? (
          <p className="m-0 text-[11px] break-all text-destructive">{state.error}</p>
        ) : null}

        {data ? (
          <div className="flex flex-col gap-2">
            <DataTable
              columns={[{ key: "label", label: "字段" }, { key: "value", label: "证据" }]}
              rowKey="label"
              locale="zh-CN"
              rows={[
                // §12：evidenceId/snapshotId 是内部标识，仅诊断模式显示。
                ...(diagnostic ? [["证据 ID", data.evidenceId]] : []),
                ["来源工具", data.toolName ?? data.sourceType],
                ...(diagnostic ? [["快照", <code key="snap" className="text-[10px]">{String(data.snapshotId).slice(0, 16)}…</code>]] : []),
                ["生成时间", new Date(data.generatedAt).toLocaleString()],
              ].map(([label, value]) => ({ label, value }))}
            />
            <ToolEnvelopeView toolName={data.toolName} envelope={data.envelope} onLocate={locateRecord} locateBusy={locateBusy} locateError={locateError} diagnostic={diagnostic} />
          </div>
        ) : null}

        {recordId && preview.loading ? <p role="status" className="text-xs text-muted-foreground">正在加载原题…</p> : null}
        {recordId && preview.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            {preview.error}
            <Button size="sm" variant="outline" onClick={() => setPreviewRetry((value) => value + 1)}>重试</Button>
          </div>
        ) : null}
        {recordId && preview.html ? (
          <div className="reviewQuestion">
            <CardPreview title="错题原题" html={preview.html} initialAutoHeight />
          </div>
        ) : null}
        {record ? <RecordCard record={record} compact={!showAnswer && Boolean(preview.html)} diagnostic={diagnostic} showAnswer={showAnswer} /> : null}

        {locateError ? <p className="m-0 text-[10px] break-all text-destructive">{locateError}</p> : null}

        <DialogFooter className="gap-2">
          {recordId ? (
            <Button
              disabled={locateBusy}
              onClick={() => { void locateRecord(recordId) }}
              size="sm"
              variant="outline"
            >
              <LocateFixedIcon />跳转原题
            </Button>
          ) : null}
          {record ? (
            <Button
              disabled={!hasAnswer}
              onClick={() => setShowAnswer((prev) => !prev)}
              size="sm"
              title={hasAnswer ? undefined : "快照中没有答案文本"}
              variant={showAnswer ? "secondary" : "outline"}
            >
              {showAnswer ? "收起答案" : "查看答案"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
