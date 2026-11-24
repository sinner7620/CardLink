import { MathBlock } from "@/components/assistant-ui/elements/math-block"
import { CitationButton } from "@/components/assistant-ui/elements/inline-citation"
import { ContextBreakdown } from "@/components/assistant-ui/elements/context-breakdown"
import { CostMeter } from "@/components/assistant-ui/elements/cost-meter"
import { AgentPlan } from "@/components/assistant-ui/elements/agent-plan"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { QuestionFlow } from "@/components/assistant-ui/elements/question-flow"
import { AnswerArtifact, QuestionGallery } from "./answer-artifacts"
import { createContext, useContext, useMemo, useState } from "react"
import { AssistantRuntimeProvider, useAssistantDataUI, useAuiState, useExternalStoreRuntime } from "@assistant-ui/react"
import rehypeHighlight from "../../lib/rehype-code-highlight"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text"
import { Sources } from "@/components/assistant-ui/elements/sources"
import { RunActivity } from "@/components/assistant-ui/elements/run-activity"
import { ToolCall } from "@/components/assistant-ui/elements/tool-call"
import { ToolError } from "@/components/assistant-ui/elements/tool-error"
import { ToolTimelineRows } from "@/components/assistant-ui/elements/tool-timeline"
import { TypingIndicator } from "@/components/assistant-ui/elements/typing-indicator"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { normalizeMathDelimiters, urlTransform } from "../ai/response"
import { sourceItemsOf } from "../ai/answer-presenter"
import { ToolBodyView } from "../ai/tool-views"
import { ContextInsights } from "./context-insights"
import { ReviewLevelConfirm, ReviewLevelMenu } from "./review-level"
import { SessionModelSelector } from "./session-model-selector"
import { BudgetTierMenu } from "./budget-tier"

const ChatContext = createContext(null)
const useCardLinkChat = () => useContext(ChatContext)

const SUGGESTIONS = [
  "今天要复习哪些错题？",
  "我有多少道待复习错题？",
  "错题的掌握等级如何分布？",
  "错题在哪些分类里最多？",
].map((prompt) => ({ prompt }))

const INCOMPLETE = {
  output_limit: "已达到输出上限，回答被截断",
  context_limit: "压缩后仍超出上下文预算",
  iteration_limit: "工具调用轮次达到上限",
  tool_result_truncated: "工具结果被截断",
}

const TOOL_LABELS = {
  getMistakeStats: "错题统计",
  queryMistakes: "查询错题",
  getMistakeDetail: "错题详情",
  getReviewHistory: "复习记录",
  listWeakPoints: "薄弱点分析",
  renderVisualization: "生成可视化",
  buildReviewQueue: "生成复习队列",
}

function toAssistantMessage(message) {
  const { id, role, createdAt, parts, finishReason, citations, evidenceRefs, plan, model } = message
  const content = parts.map((part) => {
    if (part.type === "text") return role === "assistant"
      ? { type: "text", text: normalizeMathDelimiters(part.text) }
      : part
    const isError = part.state === "output-denied" || part.state === "output-error"
    return {
      type: "tool-call",
      toolName: part.type.slice(5),
      toolCallId: part.toolCallId,
      result: isError ? part.output ?? null : part.output,
      artifact: part.rawCall,
      isError,
    }
  })
  if (role === "assistant" && plan?.length) {
    const completed = parts.filter((part) => part.type.startsWith("tool-"))
    const steps = plan.map((step, index) => {
      const match = completed.findIndex((part) => part.type === "tool-" + step.toolName)
      const [result] = match < 0 ? [] : completed.splice(match, 1)
      return { id: String(index), label: step.label, status: result?.state === "output-available" ? "done"
        : result?.state === "output-denied" ? "skipped" : result?.state === "output-error" ? "failed" : "pending" }
    })
    content.unshift({ type: "data-cardlink-plan", data: { steps } })
  }
  if (role === "assistant" && model?.name) content.push({ type: "data-cardlink-model", data: model })
  if (role === "assistant" && (citations?.length || evidenceRefs?.length || INCOMPLETE[finishReason])) {
    content.push({ type: "data-cardlink-evidence", data: { citations, evidenceRefs, finishReason } })
  }
  return {
    id, role, content,
    createdAt: new Date(createdAt),
    metadata: role === "assistant" ? { custom: { citations, evidenceRefs } } : undefined,
  }
}

export function CardLinkRuntimeProvider({ chat, requestDelete, children }) {
  const { setOpenMobile } = useSidebar()
  const { sessions, activeSessionId, running } = chat
  const threads = useMemo(() => sessions.map((session) => ({
    status: "regular",
    id: session.id,
    title: session.title || session.lastPreview || "未命名会话",
  })), [sessions])
  const last = chat.messages[chat.messages.length - 1]
  const canContinue = Boolean(activeSessionId && !running && (chat.continuable || INCOMPLETE[last?.finishReason]))
  const runtime = useExternalStoreRuntime({
    messages: chat.messages,
    convertMessage: toAssistantMessage,
    isRunning: running,
    isLoading: chat.sessionLoading,
    isDisabled: !activeSessionId || chat.sessionLoading || chat.modelBusy || Boolean(chat.pendingQuestion),
    suggestions: chat.pendingQuestion || running ? undefined : chat.messages.length
      ? last?.followUps?.map((prompt) => ({ prompt }))
      : SUGGESTIONS,
    canResume: canContinue,
    onNew: (message) => chat.send(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")),
    onCancel: chat.runStatus?.runId ? chat.stop : undefined,
    onResume: chat.continueTurn,
    onEdit: (message) => chat.forkTurn(message.sourceId, "edit",
      message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")),
    onReload: (parentId) => chat.forkTurn(parentId, "regenerate"),
    adapters: {
      threadList: {
        threadId: activeSessionId || undefined,
        isLoading: chat.sessionsLoading,
        threads,
        onSwitchToThread: async (id) => {
          setOpenMobile(false)
          if (id !== activeSessionId) await chat.openSession(id)
        },
        onSwitchToNewThread: async () => {
          if (running) return
          setOpenMobile(false)
          await chat.createSession()
        },
        onRename: async (id, title) => { await chat.renameSession(id, title) },
        onDelete: (id) => { requestDelete(sessions.find((item) => item.id === id) || { id }) },
      },
    },
  })
  return (
    <ChatContext.Provider value={chat}>
      <AssistantRuntimeProvider runtime={runtime}>
        <EvidenceRenderer />
        <PlanRenderer />
        <ModelIdentityRenderer />
        {children}
      </AssistantRuntimeProvider>
    </ChatContext.Provider>
  )
}

const MARKDOWN_OPTIONS = {
  remarkPlugins: [remarkMath],
  rehypePlugins: [[rehypeKatex, { strict: "ignore", output: "html", maxSize: 30 }], rehypeHighlight],
  urlTransform,
  skipHtml: true,
}

function CitationLink({ href, children }) {
  const chat = useCardLinkChat()
  const refs = useAuiState((state) => state.message.metadata.custom)
  const match = /^(card|stat):(.+)$/.exec(href || "")
  if (!match) return <span className="text-primary underline">{children}</span>
  const [, kind, id] = match
  const verified = refs?.citations?.some((item) => item.type === kind && item.available !== false
    && (kind === "card" ? item.recordId : item.statsId) === id)
    || refs?.evidenceRefs?.includes(kind === "card" ? id : "stat:" + id)
  return (
    <CitationButton
      className="inline h-auto whitespace-normal text-left text-xs text-primary"
      data-citation={kind}
      onClick={() => verified
        ? (kind === "card" ? chat.openRecord(id) : chat.openStat(id))
        : chat.rejectCitation(kind, id)}
    >
      {children}
    </CitationButton>
  )
}

function MarkdownSpan({ className, children, node, ...props }) {
  const expression = <span className={className} {...props}>{children}</span>
  return className?.split(" ").includes("katex-display")
    ? <MathBlock className="max-w-none" steps={[{ expression }]} visibleSteps={1} />
    : expression
}

const MARKDOWN_COMPONENTS = { a: CitationLink, span: MarkdownSpan, img: ({ alt }) => alt || null }

function CardLinkMarkdown() {
  return <MarkdownText components={MARKDOWN_COMPONENTS} options={MARKDOWN_OPTIONS} />
}

function EvidenceSummary({ data }) {
  const chat = useCardLinkChat()
  const [open, setOpen] = useState(false)
  const items = sourceItemsOf(data, chat.recordTitles)
  const incomplete = INCOMPLETE[data.finishReason]
  const sources = items.map((item) => ({
    title: item.label,
    snippet: item.sub,
    onOpen: item.available && item.id
      ? () => item.kind === "card" ? chat.openRecord(item.id) : chat.openStat(item.id)
      : undefined,
  }))
  return (
    <div className="flex flex-col items-start gap-2">
      {sources.length > 0 && <Sources sources={sources} open={open} onOpenChange={setOpen} layout="list" locale="zh-CN" />}
      {incomplete && <Alert variant="warning"><AlertDescription>回答未完成，{incomplete}。</AlertDescription></Alert>}
    </div>
  )
}

function EvidenceRenderer() {
  useAssistantDataUI({ name: "cardlink-evidence", render: EvidenceSummary })
  return null
}

const PHASE_LABELS = {
  review_pending: "正在审核工具调用",
  tool_pending: "正在执行工具",
  tool_completed: "正在整理回答",
  final_pending: "正在整理回答",
}

export function RunIndicator({ phase }) {
  const phaseLabel = PHASE_LABELS[phase]
  if (phaseLabel) return <RunActivity status="running" statusLabel={phaseLabel} entries={[]} open={false} onOpenChange={() => {}} />
  return <TypingIndicator variant="bare" label="思考中" />
}

function CardLinkRunIndicator() {
  const chat = useCardLinkChat()
  if (chat.runStatus?.toolCalls?.length) return null
  return <RunIndicator phase={chat.runStatus?.phase} />
}

function toolEvidenceId(evidenceJson) {
  if (typeof evidenceJson !== "string") return undefined
  try { return JSON.parse(evidenceJson)?.evidenceId } catch { return undefined }
}

export function CardLinkToolResult({ toolName, call, result, diagnostic, onPreview }) {
  const audit = call?.reviewerApproved === true ? "审核通过"
    : call?.reviewerApproved === false ? "审核拒绝"
    : call?.reviewerReason?.startsWith("tier_skip") ? "免审" : null
  const evidenceId = diagnostic ? toolEvidenceId(call?.evidenceJson) : undefined
  return (
    <>
      {audit && <Badge variant="secondary">{audit}</Badge>}
      {diagnostic && call?.argsHash && <p>argsHash <code>{call.argsHash}</code></p>}
      {evidenceId && <p>evidenceId <code>{evidenceId}</code></p>}
      {result != null && <ToolBodyView data={result} raw={result} diagnostic={diagnostic} onPreview={onPreview} toolName={toolName} />}
    </>
  )
}

function CardLinkRunActivity({ group, children }) {
  const chat = useCardLinkChat()
  const messageStatus = useAuiState((state) => state.message.status)
  const [open, setOpen] = useState(false)
  const status = messageStatus?.type === "running" ? "running"
    : messageStatus?.type === "incomplete" ? "incomplete"
    : "complete"
  const count = group.indices.length
  const duration = useAuiState((state) => {
    const first = state.message.parts[group.indices[0]]
    return first?.type === "tool-call" ? first.artifact?.durationMs : undefined
  })
  const label = status === "running" ? (PHASE_LABELS[chat.runStatus?.phase] || "正在运行") : ""
  return (
    <RunActivity status={status} statusLabel={`运行详情 · ${count} 项工具`} durationLabel={Number.isFinite(duration) ? `${(duration / 1000).toFixed(1)} 秒` : undefined} open={open} onOpenChange={setOpen}
      entries={[{ id: "tools", kind: "tool", label, content: <ToolTimelineRows className="ps-0 pt-0">{children}</ToolTimelineRows> }]}
    />
  )
}

function CardLinkTool({ toolName, artifact, isError, result, status }) {
  const chat = useCardLinkChat()
  const [open, setOpen] = useState(false)
  const running = status?.type === "running" || status?.type === "requires-action"
  const title = TOOL_LABELS[toolName] || toolName
  const failed = isError || status?.type === "incomplete"
  const outcome = artifact?.executionStatus === "timeout" ? "执行超时"
    : artifact?.executionStatus === "denied" || artifact?.reviewerApproved === false ? "调用被拒绝"
    : artifact?.policyStatus === "invalid_args" ? "参数无效"
    : failed ? "执行失败" : "已执行"
  return (
    <ToolCall label={outcome} activeLabel="正在执行" query={title} running={running} failed={failed}
      failureLabel={outcome} open={open} onOpenChange={setOpen} className="max-w-none">
      <div className="space-y-2 p-3.5 text-sm">
        {failed && <ToolError name={outcome} target={title}
          message={chat.diagnostic && artifact?.reviewerReason ? artifact.reviewerReason : outcome} />}
        {toolName === "renderVisualization" || toolName === "buildReviewQueue" ? (
          <AnswerArtifact data={result} chat={chat} />
        ) : (
          <CardLinkToolResult toolName={toolName} call={artifact} result={result} diagnostic={chat.diagnostic} onPreview={chat.openRecord} />
        )}
        {(toolName === "getMistakeDetail" || toolName === "queryMistakes") &&
          <QuestionGallery records={result?.records ?? (result?.record ? [result.record] : [])} chat={chat} />}
      </div>
    </ToolCall>
  )
}

function ComposerExtra() {
  const chat = useCardLinkChat()
  return <><SessionModelSelector chat={chat} /><ReviewLevelMenu chat={chat} /><BudgetTierMenu chat={chat} /><ReviewLevelConfirm chat={chat} /></>
}

const tokenFormat = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 })

const CONTEXT_SEGMENTS = [
  ["系统指令", "instructionTokens", "bg-blue-500"],
  ["工具定义", "toolDefinitionTokens", "bg-violet-500"],
  ["会话消息", "messageTokens", "bg-emerald-500"],
  ["压缩摘要", "compactionTokens", "bg-amber-500"],
  ["工具结果", "toolResultTokens", "bg-cyan-500"],
  ["结构开销", "overheadTokens", "bg-muted-foreground"],
]

function ConversationUsageSummary({ chat }) {
  const requests = chat.insights?.requests ?? []
  const latest = requests[0]
  if (!latest?.breakdown || !latest.budget?.inputBudgetTokens) return null
  const segments = CONTEXT_SEGMENTS.flatMap(([label, field, tint]) => {
    const tokens = latest.breakdown[field]
    return Number.isFinite(tokens) && tokens > 0 ? [{ label, tokens, tint }] : []
  })
  const rows = requests.filter((item) => item.runId === latest.runId)
  const currency = [...new Set(rows.map((item) => item.cost?.currency).filter(Boolean))]
  const sessionCosts = chat.insights?.cost?.session ?? []
  const latestComplete = rows.length < requests.length || requests.length === 1
  const costKnown = latestComplete && currency.length === 1 && rows.every((item) => Number.isFinite(item.cost?.amount))
  const total = costKnown ? rows.reduce((amount, item) => amount + item.cost.amount, 0) : 0
  const money = (amount, unit) => `${unit} ${Number(amount).toFixed(4)}`
  return <div className="space-y-2 pb-2">
    <ContextBreakdown segments={segments} limit={latest.budget.inputBudgetTokens} className="max-w-none" />
    {sessionCosts.length > 0 ? <CostMeter
      runCost={costKnown ? money(total, currency[0]) : "金额未知"}
      sessionCost={sessionCosts.map((row) => row.amount == null ? "部分费用未知" : money(row.amount, row.currency)).join(" · ")}
      lines={[]} className="max-w-none" /> : null}
  </div>
}

function ComposerUsage() {
  const chat = useCardLinkChat()
  const context = chat.contextUsage?.context
  if (!chat.contextUsage && !chat.insights) return null
  const usage = Number.isFinite(context?.estimatedInputTokens) && context?.inputBudgetTokens > 0
    ? tokenFormat.format(context.estimatedInputTokens) + " / " + tokenFormat.format(context.inputBudgetTokens)
    : "上下文"
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label="上下文与费用详情" className="font-mono text-xs text-muted-foreground" size="sm" variant="ghost" type="button">
          {usage}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="harness-ui max-h-[min(70vh,560px)] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto">
        <ConversationUsageSummary chat={chat} />
        <ContextInsights chat={chat} />
      </PopoverContent>
    </Popover>
  )
}

function PlanRenderer() {
  useAssistantDataUI({
    name: "cardlink-plan",
    render: ({ data }) => <AgentPlan title="执行计划" activeIndex={0} steps={data.steps} />,
  })
  return null
}

function ModelIdentityRenderer() {
  useAssistantDataUI({ name: "cardlink-model",
    render: ({ data }) => <span className="text-xs text-muted-foreground" title={data.provider}>模型 {data.name}
      {["low", "high", "max"].includes(data.effort) ? ` · 推理 ${({ low: "低", high: "高", max: "最高" })[data.effort]}` : ""}
    </span>,
  })
  return null
}

function ComposerFooter() {
  const chat = useCardLinkChat()
  const { feedback, pendingQuestion } = chat
  if (pendingQuestion) return <div className="space-y-2" data-slot="cardlink-pending-question">
    <QuestionFlow key={pendingQuestion.questionId} steps={pendingQuestion.steps}
      defaultValue={pendingQuestion.submittedAnswers ?? pendingQuestion.draft} completeLabel="提交并继续"
      onDraftChange={chat.saveQuestionDraft}
      onComplete={chat.answerQuestion} />
    <Button type="button" size="sm" variant="ghost" disabled={chat.questionBusy} onClick={chat.cancelQuestion}>取消本轮</Button>
    {chat.questionError && <p role="alert" className="text-xs text-destructive">{chat.questionError}</p>}
  </div>
  if (feedback?.tone === "error") return <ErrorState title="本轮未完成" detail={feedback.text}
    retrying={chat.running} onRetry={chat.continuable ? chat.continueTurn : undefined} />
  const plan = chat.running && chat.runStatus?.plan?.length >= 2 ? chat.runStatus.plan : null
  const tools = [...(chat.runStatus?.toolCalls ?? [])]
  return <>
    {plan && <AgentPlan title="执行计划" activeIndex={0} steps={plan.map((item, index) => {
      const at = tools.findIndex((call) => call.toolName === item.toolName)
      const [call] = at < 0 ? [] : tools.splice(at, 1)
      return { id: String(index), label: item.label, status: !call ? "pending"
        : call.executionStatus === "executed" ? "done" : call.executionStatus === "denied" ? "skipped" : "failed" }
    })} />}
    {feedback && <Alert role="status" variant="info"><AlertDescription>{feedback.text}</AlertDescription></Alert>}
  </>
}

export const THREAD_COMPONENTS = {
  Text: CardLinkMarkdown,
  Indicator: CardLinkRunIndicator,
  ToolFallback: CardLinkTool,
  ToolGroup: CardLinkRunActivity,
  ComposerExtra,
  ComposerTrailing: ComposerUsage,
  ComposerFooter,
}
