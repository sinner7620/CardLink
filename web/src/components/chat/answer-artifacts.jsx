import { createContext, useContext, useEffect, useRef, useState } from "react"
import { GenerativeUIRender } from "@assistant-ui/react"
import { Chart } from "@/components/assistant-ui/elements/chart"
import { ComparisonCard } from "@/components/assistant-ui/elements/comparison-card"
import { DataTable } from "@/components/assistant-ui/elements/data-table"
import { Diagram } from "@/components/assistant-ui/elements/diagram"
import { FlowGraph } from "@/components/assistant-ui/elements/flow-graph"
import { ImageGallery } from "@/components/assistant-ui/elements/image-gallery"
import { ScheduleCard } from "@/components/assistant-ui/elements/schedule-card"
import { ScoreBreakdown } from "@/components/assistant-ui/elements/score-breakdown"
import { SpecSheet } from "@/components/assistant-ui/elements/spec-sheet"
import { Timeline } from "@/components/assistant-ui/elements/timeline"
import { Button } from "@/components/ui/button"
import { CardPreview } from "../../CardPreview"
import { PreviewFrame, ResourceImage } from "../../SceneResources"
import { ensureHtml2Canvas } from "../../lib/html2canvas-loader.mjs"
import { sceneCaptureOptions } from "../../lib/sceneResources"
import { harnessSend } from "../../lib/harnessClient"

const LABELS = {
  totalRecords: "错题总数", totalMistakes: "错题总数", availableRecords: "原题可用", dueCount: "应复习",
  reviewedRecordCount: "已复习错题", totalReviewActions: "复习动作", sourceTitle: "题目", level: "等级",
  nextReviewAt: "到期时间", reviewCount: "复习次数", verifiedReviewCount: "已核验复习次数",
}

function labelOf(field) { return LABELS[field] || field }

function ConceptGraph({ data }) {
  const [zoom, setZoom] = useState(1)
  const nodes = data.nodes.map((node, index) => ({
    ...node, column: index % 3, row: Math.floor(index / 3), state: "pending",
  }))
  const graph = <FlowGraph nodes={nodes} edges={data.edges} visibleCount={nodes.length} />
  return <div className="space-y-1">
    <div className="text-xs text-muted-foreground">模型生成示意图</div>
    {data.view === "diagram" ? <Diagram title={data.title} zoom={zoom}
      onZoomIn={() => setZoom((value) => Math.min(value + 0.1, 1.5))}
      onZoomOut={() => setZoom((value) => Math.max(value - 0.1, 0.5))}
      onReset={() => setZoom(1)}>{graph}</Diagram> : graph}
  </div>
}

function EvidenceView({ data, chat }) {
  const rows = data.sources.flatMap((source) => source.rows.map((row) =>
    Object.fromEntries(row.map((cell) => [cell.field, cell.value]))))
  const fields = [...new Set(rows.flatMap(Object.keys))]
  const numeric = fields.filter((field) => rows.some((row) => typeof row[field] === "number"))
  const title = data.title || "错题数据"
  let content
  if (data.view === "chart" && numeric.length) {
    const field = numeric[0]
    const points = rows.map((row) => row[field]).filter((value) => typeof value === "number")
    content = <Chart label={labelOf(field)} value={String(points[points.length - 1])} points={points} visibleCount={points.length} variant="bars" />
  } else if (data.view === "spec") {
    const details = fields.map((field) => ({ label: labelOf(field), value: rows.flatMap((row) => row[field] ?? []).join("、") }))
    content = <SpecSheet title={title} rows={details} visibleCount={details.length} />
  } else if (data.view === "comparison") {
    const options = rows.map((row, index) => ({
      id: String(index), name: String(row.sourceTitle ?? row.label ?? index + 1), headline: "",
      traits: fields.map((field) => row[field] == null ? "—" : String(row[field])),
    }))
    content = <ComparisonCard traitLabels={fields.map(labelOf)} options={options} recommendedId="" reason="" />
  } else if (data.view === "timeline" && rows.some((item) => item.at || item.date || item.nextReviewAt)) {
    const events = rows.flatMap((item, index) => {
      const time = item.at ?? item.date ?? item.nextReviewAt
      if (!time) return []
      return [{ id: String(index), when: Date.parse(time) > Date.parse(data.dataAsOf) ? "future" : "past", time,
        title: String(item.sourceTitle ?? item.label ?? "复习记录") }]
    })
    content = <Timeline events={events} visibleCount={events.length} />
  } else if (data.view === "scoreBreakdown" && rows.length === 1 && typeof rows[0].score === "number" && Number(rows[0].outOf) > 0) {
    const row = rows[0]
    content = <ScoreBreakdown total={row.score} outOf={row.outOf} verdict={title}
      criteria={[]} visibleCount={0} />
  } else {
    content = <DataTable title={title} columns={fields.map((field) => ({ key: field, label: labelOf(field) }))} rows={rows} />
  }
  return <div className="space-y-2">
    {content}
    <p className="text-xs text-muted-foreground">数据截至 {new Date(data.dataAsOf).toLocaleString("zh-CN")}</p>
    {data.sources.map((source, index) => <Button key={source.evidenceId} size="sm" variant="link"
      onClick={() => chat.openStat(source.evidenceId)}>查看来源 {index + 1}</Button>)}
  </div>
}

function ReviewProposal({ data, chat }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  async function start() {
    setBusy(true)
    setNotice("")
    try {
      const response = await harnessSend("plugin.startReviewQueue", {
        artifactId: data.artifactId, sessionId: chat.activeSessionId, branchId: chat.branchView?.branchId,
      })
      if (!response?.ok || !response.data?.started) throw new Error(response?.error?.message || response?.data?.reason || "复习未开始")
      setNotice(response.data.skipped ? `已跳过 ${response.data.skipped} 道不可用原题` : "")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  return <ScheduleCard name="复习队列建议" cadence={`${data.count} 题${data.hasMore ? " · 还有符合条件的题目" : ""}`}
    dateLabel="建议日期" nextRun={new Date(data.rules.statsTime).toLocaleDateString("zh-CN", { timeZone: data.rules.timezone })}
    enabled history={[]} details={<div className="space-y-2">
      {data.items.length ? <ol className="list-decimal ps-4 text-xs">
        {data.items.map((item) => <li key={item.recordId}>{item.title || "错题"} · {item.reason}</li>)}
      </ol> : <p className="text-xs">没有符合条件的可复习题目。</p>}
      {data.estimate === "unavailable" && <p className="text-xs text-muted-foreground">无法估算是否能在时间预算内完成。</p>}
      <Button size="sm" disabled={busy || !data.items.length} onClick={start}>开始复习</Button>
      {notice && <p role="status" className="text-xs">{notice}</p>}
    </div>} />
}

const ArtifactChat = createContext(null)

const ARTIFACT_COMPONENTS = {
  ConceptGraph,
  EvidenceView: ({ data }) => <EvidenceView data={data} chat={useContext(ArtifactChat)} />,
  ReviewProposal: ({ data }) => <ReviewProposal data={data} chat={useContext(ArtifactChat)} />,
}

export function AnswerArtifact({ data, chat }) {
  if (!data?.artifactId || data.version !== 1) return null
  const component = Array.isArray(data.items) ? "ReviewProposal"
    : data.kind === "concept" ? "ConceptGraph" : data.kind === "evidence" ? "EvidenceView" : null
  if (!component) return null
  return <ArtifactChat.Provider value={chat}>
    <GenerativeUIRender components={ARTIFACT_COMPONENTS} spec={{ root: { component, props: { data } } }} />
  </ArtifactChat.Provider>
}

function QuestionRaster({ html, title, onError }) {
  const [image, setImage] = useState("")
  const started = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function render({ currentTarget: frame }) {
    if (started.current || !frame?.contentDocument) return
    const doc = frame.contentDocument
    started.current = true
    try {
      if (!doc.body?.textContent?.trim() && !doc.images.length) throw new Error("没有可渲染的题干")
      await Promise.all([...doc.images].map((node) => node.decode ? node.decode() : Promise.resolve()))
      await doc.fonts?.ready
      const width = Math.max(1, doc.body.scrollWidth)
      const height = Math.max(1, doc.body.scrollHeight)
      const capture = await ensureHtml2Canvas()
      const canvas = await capture(doc.body, {
        ...sceneCaptureOptions(doc), width, height, windowWidth: width, windowHeight: height,
        backgroundColor: "#ffffff", logging: false, allowTaint: false, useCORS: false,
        scale: Math.min(1.5, 1200 / width, 3600 / height),
      })
      const result = canvas.toDataURL("image/jpeg", 0.9)
      canvas.width = 1
      canvas.height = 1
      if (mounted.current) setImage(result)
    } catch {
      if (mounted.current) onError("题干图片暂不可用，可跳转原题查看。")
    }
  }

  if (image) return <ResourceImage src={image} alt={title} className="mx-auto max-h-[32rem] max-w-full object-contain" />
  return <div className="pointer-events-none fixed -left-[150vw] top-0" aria-hidden="true">
    <PreviewFrame title="题干渲染" tabIndex={-1} html={html} onLoad={render}
      onError={() => onError("题干图片暂不可用，可跳转原题查看。")}
      style={{ width: "640px", height: "320px", border: 0 }} />
  </div>
}

function GalleryItem({ item, chat }) {
  const [preview, setPreview] = useState(null)
  const [answers, setAnswers] = useState(null)
  const [showAnswers, setShowAnswers] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const payload = { recordId: item.id, sessionId: chat.activeSessionId, branchId: chat.branchView?.branchId }
  async function load(kind) {
    if (kind === "answer" && answers) { setShowAnswers((shown) => !shown); return }
    setBusy(kind)
    setError("")
    try {
      const result = await harnessSend(kind === "answer" ? "plugin.previewAnswer" : "plugin.previewRecord", { ...payload, questionOnly: true })
      if (!result?.ok) throw new Error(result?.error?.message || "内容不可用")
      if (kind === "answer") {
        setAnswers(result.data.answers || [])
        setShowAnswers(true)
      } else setPreview(result.data.questionHtml)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy("") }
  }
  return <div className="space-y-2">
    {preview ? <QuestionRaster html={preview} title={item.alt} onError={setError} /> :
      <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => load("question")}>查看题干</Button>}
    <div className="flex flex-wrap items-center gap-1">
      <span className="me-auto min-w-0 text-xs">{item.alt}</span>
      <Button size="sm" variant="link" onClick={async () => {
        const response = await harnessSend("plugin.locateRecord", payload)
        setError(response?.ok ? "" : response?.error?.message || "原题不可访问")
      }}>跳转原题</Button>
      <Button size="sm" variant="link" disabled={Boolean(busy)} onClick={() => load("answer")}>{showAnswers ? "收起答案" : "答案"}</Button>
    </div>
    {showAnswers && (answers.length ? answers.map((answer) =>
      <CardPreview key={answer.id} title={answer.title || "答案"} html={answer.html} initialAutoHeight />) :
      <p className="text-xs">未匹配到可读取的答案。</p>)}
    {error && <p role="alert" className="text-xs">{error}</p>}
  </div>
}

export function QuestionGallery({ records, chat }) {
  const images = records.filter((record) => record.recordId && record.sourceAvailable !== false).slice(0, 6)
    .map((record) => ({ id: record.recordId, src: "", alt: record.sourceTitle || "错题" }))
  return <ImageGallery aria-label="题目预览" images={images} className="max-w-none"
    renderItem={(item) => <GalleryItem item={item} chat={chat} />} />
}
