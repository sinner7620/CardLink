import { useCallback, useEffect, useRef, useState } from "react"
import { harnessSend, newRequestId } from "../../lib/harnessClient"

/**
 * CardLink 会话的状态与业务动作。assistant-runtime 将其投影给官方聊天组件。
 */

export const SCENE_READY = typeof window !== "undefined" && window.__MN_SCENE_ENABLED__ === true && Boolean(window.mn)
const DEFAULT_REVIEW_LEVEL = "provenance"

export const REVIEW_LEVELS = [
  { value: "strict", label: "严格审核", hint: "所有工具调用都经模型审核者复核" },
  { value: "provenance", label: "溯源免审", hint: "可溯源的详情/历史下钻免审，新数据访问仍复核" },
  { value: "full_allow", label: "完全允许", hint: "只保留确定性检查，不再调用模型审核者" },
]

/** v2.16 §11.3：运行预算档位（与 Harness 规范一致；由用户选择，模型无权扩大）。 */
export const BUDGET_OPTIONS = [
  { value: "simple", label: "简单", hint: "4 次迭代 / 8 次工具（默认）" },
  { value: "comparison", label: "多题比较", hint: "8 次迭代 / 16 次工具" },
  { value: "deep", label: "深度诊断", hint: "12 次迭代 / 24 次工具" },
]
const DEFAULT_BUDGET_TIER = "simple"

const DIAGNOSTIC_KEY = "cardlink.agent.diagnostic"
/** v2.14 §22：请求明细分页有界（每次 8 条，最多累计 60 条）。 */
const INSIGHT_PAGE = 8
const INSIGHT_MAX_ROWS = 60

function insightRowKey(item) {
  return `${item?.runId ?? ""}-${item?.requestSeq ?? ""}`
}

function newUiId() {
  const c = typeof crypto !== "undefined" ? crypto : undefined
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function safeParse(json) {
  if (!json) return undefined
  try { return JSON.parse(json) } catch { return undefined }
}

function readDiagnostic() {
  try {
    if (typeof window === "undefined") return false
    return window.localStorage?.getItem(DIAGNOSTIC_KEY) === "1"
  } catch {
    return false
  }
}

function reviewLevelOf(session) {
  const level = session?.reviewLevel
  return REVIEW_LEVELS.some((item) => item.value === level) ? level : DEFAULT_REVIEW_LEVEL
}

function budgetTierOf(session) {
  const tier = session?.budgetTier
  return BUDGET_OPTIONS.some((item) => item.value === tier) ? tier : DEFAULT_BUDGET_TIER
}

export function formatRelative(value) {
  const time = Date.parse(value ?? "")
  if (!Number.isFinite(time)) return "—"
  const diff = Date.now() - time
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return new Date(time).toLocaleDateString()
}

function toolStateOf(executionStatus) {
  if (executionStatus === "executed") return "output-available"
  if (executionStatus === "denied") return "output-denied"
  if (["timeout", "error", "not_executed", "invalid_args"].includes(executionStatus)) return "output-error"
  return "input-available"
}

/** 运行时 toolCalls → ChatMessage part（tool-<name>，与 chatbot 的 parts 模型一致）。 */
function toolPartOf(call) {
  const envelope = safeParse(call.resultJson)
  return {
    type: `tool-${call.toolName || "tool"}`,
    toolCallId: call.toolCallId,
    state: toolStateOf(call.executionStatus),
    input: undefined,
    output: envelope?.data ?? envelope,
    rawCall: call,
  }
}

/** 持久化消息 → ChatMessage（渲染层只认 role + parts）。 */
export function toChatMessage(message, index, toolActivity = {}) {
  const id = message.id || `${message.type}-${index}`
  const createdAt = message.createdAt || new Date().toISOString()
  if (message.type === "user") {
    return { id, role: "user", createdAt, parts: [{ type: "text", text: message.text || "" }] }
  }
  if (message.type === "tool_result") {
    const tool = message.content?.tool || "tool"
    return {
      id,
      role: "assistant",
      createdAt,
      parts: [{
        type: `tool-${tool}`,
        toolCallId: message.toolCallId || id,
        state: message.status === "ok" || message.status === undefined
          ? "output-available"
          : message.status === "denied" ? "output-denied" : "output-error",
        output: message.content?.data,
        rawCall: toolActivity[message.id] ?? toolActivity[message.toolCallId] ?? { executionStatus: message.status },
      }],
    }
  }
  return {
    id,
    role: "assistant",
    createdAt,
    parts: [{ type: "text", text: message.text || "" }],
    citations: Array.isArray(message.citations) ? message.citations : undefined,
    evidenceRefs: message.evidenceRefs || [],
    finishReason: message.finishReason,
  }
}

export function toChatHistory(messages, toolActivity, publicOutcomes) {
  const history = []
  let pendingTools = []
  const flush = (answer) => {
    if (!pendingTools.length) return
    const parts = pendingTools.flatMap((tool) => tool.parts)
    if (answer) answer.parts = parts.concat(answer.parts)
    else history.push({ ...pendingTools[0], parts })
    pendingTools = []
  }
  for (const [index, item] of messages.entries()) {
    if (item.type === "assistant" && item.toolCalls?.length) continue
    const message = toChatMessage(item, index, toolActivity)
    const outcome = publicOutcomes?.[item.id]
    if (outcome) { message.followUps = outcome.followUps; message.plan = outcome.plan; message.model = outcome.model }
    if (item.type === "tool_result") {
      const previousRunId = pendingTools[0]?.parts[0]?.rawCall?.runId
      const runId = message.parts[0]?.rawCall?.runId
      if (previousRunId && runId && runId !== previousRunId) flush()
      pendingTools.push(message)
      continue
    }
    flush(item.type === "assistant" ? message : undefined)
    history.push(message)
  }
  flush()
  return history
}

export function useHarnessChat() {
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState("")
  const [sessionModel, setSessionModel] = useState(null)
  const [modelBusy, setModelBusy] = useState(false)
  const activePolls = useRef(new Map())
  const [backgroundRuns, setBackgroundRuns] = useState([])
  const [pendingQuestion, setPendingQuestion] = useState(null)
  const [questionBusy, setQuestionBusy] = useState(false)
  const [questionError, setQuestionError] = useState("")
  const submissionRef = useRef(null)
  const [branchView, setBranchView] = useState(null)
  const branchIdRef = useRef(undefined)
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState("ready")
  const [runStatus, setRunStatus] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [continuable, setContinuable] = useState(false)
  const [evidenceId, setEvidenceId] = useState("")
  const [recordRef, setRecordRef] = useState("")
  const [snapshot, setSnapshot] = useState({ id: "", keySet: false })
  const [reviewLevel, setReviewLevel] = useState(DEFAULT_REVIEW_LEVEL)
  const [pendingLevel, setPendingLevel] = useState("")
  const [levelBusy, setLevelBusy] = useState(false)
  // v2.16 §11.3：运行预算档位（会话默认选中；Run 入列时固定）。
  const [budgetTier, setBudgetTier] = useState(DEFAULT_BUDGET_TIER)
  const [budgetBusy, setBudgetBusy] = useState(false)
  // v2.16 §6.3：本地源新鲜度（current/stale/unknown；打开与开始运行时自动检查）。
  const [freshness, setFreshness] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionQuery, setSessionQuery] = useState("")
  const [recordTitles, setRecordTitles] = useState({})
  const [diagnostic, setDiagnostic] = useState(readDiagnostic)
  // v2.14 §22：上下文用量明细（只读查询；空态/加载/错误分别呈现）。
  const [insights, setInsights] = useState(null)
  const [insightsState, setInsightsState] = useState("idle")
  const [insightsError, setInsightsError] = useState("")

  const running = status === "submitted" || status === "streaming"
  const activeSessionIdRef = useRef("")
  const requestedTitleRefsRef = useRef(new Set())
  const pendingMessageIdRef = useRef("")
  const autoCreatedRef = useRef(false)
  const insightsSessionRef = useRef("")

  useEffect(() => { activeSessionIdRef.current = activeSessionId }, [activeSessionId])

  /**
   * v2.14 §22：读取本会话的请求用量明细（只读命令；不含任何正文）。
   * 会话切换后丢弃迟到响应，避免把旧会话数据画到新会话上。
   */
  const refreshInsights = useCallback(async (sessionIdArg) => {
    const sessionId = typeof sessionIdArg === "string" && sessionIdArg ? sessionIdArg : activeSessionIdRef.current
    if (!SCENE_READY || !sessionId) {
      insightsSessionRef.current = ""
      setInsights(null)
      setInsightsState("idle")
      setInsightsError("")
      return
    }
    insightsSessionRef.current = sessionId
    setInsightsState("loading")
    try {
      const res = await harnessSend("harness.getContextInsights", { sessionId, branchId: branchIdRef.current, limit: INSIGHT_PAGE, days: 7 })
      if (activeSessionIdRef.current !== sessionId) return
      if (!res?.ok) {
        setInsightsError(res?.error?.message || "上下文记录读取失败")
        setInsightsState("error")
        return
      }
      const data = res.data || null
      setInsights(data ? { ...data, requests: [...(data.requests || [])] } : null)
      setInsightsError("")
      setInsightsState("ready")
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return
      setInsightsError(error instanceof Error ? error.message : String(error))
      setInsightsState("error")
    }
  }, [])

  /** 追加更早的一页（有界：最多 60 条，按 runId+序号去重）。 */
  const loadOlderInsights = useCallback(async () => {
    const sessionId = insightsSessionRef.current
    if (!sessionId || !insights?.hasMore) return
    const offset = Math.min(insights.requests.length, INSIGHT_MAX_ROWS)
    try {
      const res = await harnessSend("harness.getContextInsights", { sessionId, branchId: branchIdRef.current, limit: INSIGHT_PAGE, offset, days: 7 })
      if (activeSessionIdRef.current !== sessionId || !res?.ok) return
      const data = res.data || {}
      setInsights((prev) => {
        if (!prev) return data
        const seen = new Set(prev.requests.map(insightRowKey))
        const extra = (data.requests || []).filter((item) => !seen.has(insightRowKey(item)))
        return { ...prev, ...data, requests: [...prev.requests, ...extra].slice(0, INSIGHT_MAX_ROWS) }
      })
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    }
  }, [insights])

  const refreshSessions = useCallback(async (query) => {
    const payload = { limit: 50 }
    const q = typeof query === "string" ? query : undefined
    if (q) payload.query = q
    const res = await harnessSend("harness.listSessions", payload)
    if (res?.ok) setSessions([...(res.data || [])].map((item) => ({ ...item })))
    setSessionsLoading(false)
  }, [])

  const refreshHealth = useCallback(async () => {
    const res = await harnessSend("harness.health")
    if (!res?.ok) return
    const snapshotId = res.data?.snapshotId
    setSnapshot({
      id: snapshotId && snapshotId !== "none" ? String(snapshotId) : "",
      keySet: res.data?.assistantConfigured ?? (res.data?.credentialRefs || []).includes("device-key"),
    })
  }, [])

  /**
   * v2.16 §6.3：本地源新鲜度。只读、无外网；打开会话/开始运行/同步后各检查一次，
   * 不做常驻轮询，也不每轮重扫笔记库。
   */
  const refreshFreshness = useCallback(async () => {
    if (!SCENE_READY) return
    const res = await harnessSend("harness.getDataFreshness")
    if (res?.ok) {
      setFreshness(res.data || null)
    } else {
      setFreshness({ status: "unknown", reason: res?.error?.message || "无法判断本地数据新鲜度" })
    }
  }, [])

  useEffect(() => {
    if (!SCENE_READY) return
    void refreshSessions()
    void refreshHealth()
    void refreshFreshness()
  }, [refreshSessions, refreshHealth, refreshFreshness])

  useEffect(() => {
    if (!SCENE_READY) return
    const handle = setTimeout(() => { void refreshSessions(sessionQuery) }, 200)
    return () => clearTimeout(handle)
  }, [sessionQuery, refreshSessions])

  const openSession = useCallback(async (sessionId, branchId) => {
    activeSessionIdRef.current = sessionId
    branchIdRef.current = branchId
    setBranchView(null)
    setPendingQuestion(null)
    setQuestionError("")
    setEvidenceId("")
    setRecordRef("")
    setActiveSessionId(sessionId)
    setSessionModel(null)
    setSessionLoading(true)
    setMessages([])
    setFeedback(null)
    const background = activePolls.current.get(sessionId)
    setStatus(background ? "streaming" : "ready")
    setRunStatus(background?.data ?? null)
    setContinuable(false)
    pendingMessageIdRef.current = ""
    const res = await harnessSend("harness.getSession", { sessionId, branchId, includeToolActivity: true })
    if (activeSessionIdRef.current !== sessionId || branchIdRef.current !== branchId) return
    setSessionLoading(false)
    if (!res?.ok) { setFeedback({ tone: "error", text: res?.error?.message || "打开会话失败" }); return }
    const view = { branchId: res.data.branchId || sessionId, branches: res.data.branches || [{ id: sessionId }] }
    branchIdRef.current = view.branchId
    setBranchView(view)
    setMessages(toChatHistory(res.data?.messages || [], res.data?.toolActivity, res.data?.publicOutcomes))
    setPendingQuestion(res.data?.pendingQuestion ?? null)
    setSessionModel(res.data?.assistantModel ?? null)
    setReviewLevel(reviewLevelOf(res.data))
    setBudgetTier(budgetTierOf(res.data))
    void refreshInsights(sessionId)
    void refreshFreshness()
  }, [refreshInsights, refreshFreshness])

  const hydrateTranscript = useCallback(async (sessionId, branchId) => {
    const res = await harnessSend("harness.getSession", { sessionId, branchId, includeToolActivity: true })
    if (res?.ok && activeSessionIdRef.current === sessionId && branchIdRef.current === branchId) {
      setMessages(toChatHistory(res.data.messages || [], res.data.toolActivity, res.data.publicOutcomes))
      setPendingQuestion(res.data.pendingQuestion ?? null)
    }
  }, [])

  const selectBranch = useCallback(async (branchId) => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId || running || branchIdRef.current === branchId) return
    const res = await harnessSend("harness.selectSessionBranch", { sessionId, branchId })
    if (activeSessionIdRef.current !== sessionId) return
    if (!res?.ok) setFeedback({ tone: "error", text: res?.error?.message || "切换分支失败" })
    else await openSession(sessionId, branchId)
  }, [running, openSession])

  const switchSessionModel = useCallback(async (providerId, model, effort) => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    setFeedback(null)
    setModelBusy(true)
    try {
      const res = await harnessSend("harness.setSessionModel", { sessionId, branchId: branchIdRef.current, providerId, model, effort })
      if (!res?.ok) throw new Error(res?.error?.message || "切换会话模型失败")
      if (activeSessionIdRef.current === sessionId) setSessionModel(res.data)
    } catch (error) {
      if (activeSessionIdRef.current === sessionId) {
        setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      setModelBusy(false)
    }
  }, [])

  const createSession = useCallback(async () => {
    const res = await harnessSend("harness.createSession", { notebookIds: [] })
    if (res?.ok) {
      await refreshSessions(sessionQuery)
      await openSession(res.data.sessionId)
    } else {
      setFeedback({ tone: "error", text: res?.error?.message || "创建会话失败" })
    }
  }, [refreshSessions, sessionQuery, openSession])

  useEffect(() => {
    if (!SCENE_READY || autoCreatedRef.current || running || sessionsLoading) return
    if (sessions.length > 0 || sessionQuery) return
    autoCreatedRef.current = true
    void createSession()
  }, [SCENE_READY, sessions, sessionsLoading, running, sessionQuery, createSession])

  const syncSnapshot = useCallback(async () => {
    setFeedback(null)
    const res = await harnessSend("harness.syncSnapshot")
    if (res?.ok) {
      setFeedback({
        tone: "info",
        text: `快照已同步：${res.data?.recordCount ?? "—"} 条（新增 ${res.data?.inserted ?? 0}，更新 ${res.data?.updated ?? 0}）`,
      })
      await refreshHealth()
      await refreshFreshness()
    } else {
      setFeedback({ tone: "error", text: res?.error?.message || "快照同步失败" })
      await refreshFreshness()
    }
  }, [refreshHealth, refreshFreshness])

  const pollRun = useCallback(async (sessionId, runId, onStatus) => {
    const key = runId
    activePolls.current.set(sessionId, { key, data: { runId, status: "active", phase: "created" } })
    setBackgroundRuns([...activePolls.current.keys()])
    try {
      for (let attempt = 0; attempt < 300; attempt++) {
        const res = await harnessSend("harness.getRunStatus", { runId })
        if (!res?.ok) throw new Error(res?.error?.message || "运行状态查询失败")
        const data = res.data
        if (activePolls.current.get(sessionId)?.key === key) activePolls.current.set(sessionId, { key, data })
        if (activeSessionIdRef.current === sessionId) {
          setRunStatus(data)
          onStatus?.(data)
        }
        if (data.status && data.status !== "active") return data
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
      throw new Error("运行状态轮询超时")
    } finally {
      if (activePolls.current.get(sessionId)?.key === key) activePolls.current.delete(sessionId)
      setBackgroundRuns([...activePolls.current.keys()])
    }
  }, [])

  /** 终态写回：只更新发起时创建的那条 assistant 消息（切换会话不污染当前列表）。 */
  const applyFinal = useCallback((sessionIdAtSend, pendingId, final) => {
    const result = final?.result || {}
    const toolParts = (final?.toolCalls || []).map(toolPartOf)
    const text = typeof result.message === "string" ? result.message.trim() : ""
    const textPart = text ? [{ type: "text", text: result.message }] : []
    if (activeSessionIdRef.current !== sessionIdAtSend) {
      setFeedback({ tone: "info", text: "后台会话的分析已完成，切回该会话可查看结果。" })
      void refreshSessions(sessionQuery)
      return
    }
    setPendingQuestion(final?.pendingQuestion ?? null)
    setMessages((prev) => prev.map((message) => message.id === pendingId
      ? {
          ...message,
          parts: [...toolParts, ...textPart],
          citations: Array.isArray(result.citations) ? result.citations : undefined,
          evidenceRefs: result.evidenceRefs || [],
          finishReason: result.finishReason,
        }
      : message).filter((message) => message.parts.length > 0 || message.role === "user" || message.finishReason))
    if (result.status === "limit_reached") {
      if (!result.finishReason) setFeedback({ tone: "info", text: "回答未完成，已达到本轮上限。" })
    } else if (final.status === "interrupted" || result.status === "interrupted") {
      setFeedback({ tone: "info", text: "本轮生成已停止。" })
    } else if (result.status !== "completed") {
      const code = result.error?.code || ""
      const message = result.error?.message || "运行失败"
      setFeedback({
        tone: "error",
        text: code === "model_error" && /provider_|credential_/.test(message)
          ? `模型未配置或不可用：${message}。请先在「AI 分析设置」配置服务商与密钥。`
          : message,
      })
    }
    if (result.warnings?.length) {
      setFeedback({ tone: "info", text: result.warnings.map((warning) => warning.detail).join("；") })
    }
    setContinuable(result.continuable === true)
    pendingMessageIdRef.current = ""
  }, [refreshSessions, sessionQuery])

  /** 追加一条 pending 助手消息，并返回更新其 parts 的函数。 */
  const beginTurn = useCallback(() => {
    const pending = { id: newUiId(), role: "assistant", createdAt: new Date().toISOString(), parts: [] }
    pendingMessageIdRef.current = pending.id
    setMessages((prev) => [...prev, pending])
    const update = (parts) => {
      setMessages((prev) => prev.map((message) => message.id === pending.id ? { ...message, parts } : message))
    }
    return { pendingId: pending.id, update }
  }, [])

  const send = useCallback(async (textArg) => {
    const text = typeof textArg === "string" ? textArg.trim() : ""
    if (!text || running || pendingQuestion) return
    if (!activeSessionId) { setFeedback({ tone: "error", text: "请先选择或创建会话" }); return }
    setFeedback(null)
    setContinuable(false)
    setStatus("submitted")
    setRunStatus({ status: "active", phase: "created", iteration: 0 })
    const sessionIdAtSend = activeSessionId
    const branchAtSend = branchIdRef.current
    setMessages((prev) => [...prev, { id: newUiId(), role: "user", createdAt: new Date().toISOString(), parts: [{ type: "text", text }] }])
    const { pendingId, update } = beginTurn()
    try {
      // v2.16 §6.3：开始运行前检查本地源是否已变化（不阻塞发送；失败按 unknown 呈现）。
      await refreshFreshness()
      const started = await harnessSend("harness.startRun", {
        sessionId: sessionIdAtSend,
        branchId: branchAtSend,
        text,
        requestId: newRequestId(),
        budgetTier,
      })
      if (!started?.ok) throw new Error(started?.error?.message || "启动失败")
      const final = await pollRun(sessionIdAtSend, started.data.runId, (data) => {
        const parts = (data.toolCalls || []).map(toolPartOf)
        if (parts.length) { setStatus("streaming"); update(parts) }
      })
      if (final) {
        applyFinal(sessionIdAtSend, pendingId, final)
        await hydrateTranscript(sessionIdAtSend, branchAtSend)
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
      setMessages((prev) => prev.filter((message) => message.id !== pendingId))
    } finally {
      if (activeSessionIdRef.current === sessionIdAtSend) {
        setStatus("ready")
        void refreshInsights(sessionIdAtSend)
      }
      void refreshSessions(sessionQuery)
    }
  }, [running, pendingQuestion, activeSessionId, budgetTier, refreshFreshness, refreshSessions, sessionQuery, applyFinal, pollRun, beginTurn, refreshInsights, hydrateTranscript])

  const continueTurn = useCallback(async () => {
    if (!activeSessionId || running || pendingQuestion) return
    setFeedback(null)
    setContinuable(false)
    setStatus("submitted")
    setRunStatus({ status: "active", phase: "created", iteration: 0 })
    const sessionIdAtSend = activeSessionId
    const branchAtSend = branchIdRef.current
    const { pendingId, update } = beginTurn()
    try {
      await refreshFreshness()
      const started = await harnessSend("harness.continueRun", {
        sessionId: sessionIdAtSend,
        branchId: branchAtSend,
        requestId: newRequestId(),
        budgetTier,
      })
      if (!started?.ok) throw new Error(started?.error?.message || "续答启动失败")
      const final = await pollRun(sessionIdAtSend, started.data.runId, (data) => {
        const parts = (data.toolCalls || []).map(toolPartOf)
        if (parts.length) { setStatus("streaming"); update(parts) }
      })
      if (final) {
        applyFinal(sessionIdAtSend, pendingId, final)
        await hydrateTranscript(sessionIdAtSend, branchAtSend)
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
      setMessages((prev) => prev.filter((message) => message.id !== pendingId))
    } finally {
      if (activeSessionIdRef.current === sessionIdAtSend) {
        setStatus("ready")
        void refreshInsights(sessionIdAtSend)
      }
      void refreshSessions(sessionQuery)
    }
  }, [activeSessionId, running, pendingQuestion, budgetTier, refreshFreshness, pollRun, applyFinal, refreshSessions, sessionQuery, beginTurn, refreshInsights, hydrateTranscript])

  const stop = useCallback(async () => {
    if (!runStatus?.runId) return
    await harnessSend("harness.cancelRun", { runId: runStatus.runId })
  }, [runStatus])

  const answerQuestion = useCallback(async (answers) => {
    const question = pendingQuestion
    const sessionId = activeSessionIdRef.current
    const branchId = branchIdRef.current
    if (!question || !sessionId || questionBusy) return
    setQuestionBusy(true)
    setQuestionError("")
    let pendingId
    try {
      if (submissionRef.current?.questionId !== question.questionId) {
        submissionRef.current = { questionId: question.questionId, id: question.submissionId ?? newRequestId() }
      }
      const started = await harnessSend("harness.answerRunQuestion", {
        sessionId, branchId, questionId: question.questionId, runId: question.runId,
        requestId: submissionRef.current.id, answers,
      })
      if (!started?.ok) throw new Error(started?.error?.message || "提交失败")
      setPendingQuestion(null)
      setStatus("submitted")
      const pending = beginTurn()
      pendingId = pending.pendingId
      const final = await pollRun(sessionId, started.data.runId, (status) => {
        const parts = (status.toolCalls || []).map(toolPartOf)
        if (parts.length) pending.update(parts)
      })
      applyFinal(sessionId, pendingId, final)
      await hydrateTranscript(sessionId, branchId)
    } catch (error) {
      if (pendingId) setMessages((prev) => prev.filter((item) => item.id !== pendingId))
      setQuestionError(error instanceof Error ? error.message : String(error))
      await hydrateTranscript(sessionId, branchId)
      throw error
    } finally {
      setQuestionBusy(false)
      if (activeSessionIdRef.current === sessionId) setStatus("ready")
    }
  }, [pendingQuestion, questionBusy, pollRun, beginTurn, applyFinal, hydrateTranscript])

  const saveQuestionDraft = useCallback((answers) => {
    if (!pendingQuestion) return
    const payload = { sessionId: activeSessionIdRef.current, branchId: branchIdRef.current,
      questionId: pendingQuestion.questionId, runId: pendingQuestion.runId, answers }
    void harnessSend("harness.saveQuestionDraft", payload).then((response) => {
      if (!response?.ok && activeSessionIdRef.current === payload.sessionId && branchIdRef.current === payload.branchId) {
        setQuestionError(response?.error?.message || "未保存当前选择")
      }
    })
  }, [pendingQuestion])

  const cancelQuestion = useCallback(async () => {
    if (!pendingQuestion || questionBusy) return
    const res = await harnessSend("harness.cancelRun", { runId: pendingQuestion.runId })
    if (!res?.ok) setQuestionError(res?.error?.message || "取消失败")
    else {
      setPendingQuestion(null)
      setQuestionError("")
      setFeedback({ tone: "info", text: "已取消本轮提问。" })
    }
  }, [pendingQuestion, questionBusy])

  const forkTurn = useCallback(async (anchorId, operation, text) => {
    if (!anchorId || running || !activeSessionId) return
    const sessionId = activeSessionId
    const branchId = branchIdRef.current
    setFeedback(null)
    setContinuable(false)
    setStatus("submitted")
    setRunStatus(null)
    try {
      const res = await harnessSend("harness.forkSession", { sessionId, branchId, anchorId, operation, text, requestId: newRequestId() })
      if (!res?.ok) throw new Error(res?.error?.message || "创建分支失败")
      branchIdRef.current = res.data.branchId
      setBranchView(res.data)
      setEvidenceId("")
      setRecordRef("")
      await hydrateTranscript(sessionId, res.data.branchId)
      const { pendingId, update } = beginTurn()
      const final = await pollRun(sessionId, res.data.runId, (data) => {
        const parts = (data.toolCalls || []).map(toolPartOf)
        if (parts.length) update(parts)
      })
      if (final) {
        applyFinal(sessionId, pendingId, final)
        await hydrateTranscript(sessionId, res.data.branchId)
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (activeSessionIdRef.current === sessionId) setStatus("ready")
      void refreshSessions(sessionQuery)
    }
  }, [running, activeSessionId, hydrateTranscript, beginTurn, pollRun, applyFinal, refreshSessions, sessionQuery])

  const applyReviewLevel = useCallback(async (level) => {
    if (!activeSessionId) { setFeedback({ tone: "error", text: "请先选择或创建会话" }); return }
    setLevelBusy(true)
    try {
      const res = await harnessSend("harness.setReviewLevel", { sessionId: activeSessionId, branchId: branchIdRef.current, level })
      if (res?.ok) {
        setReviewLevel(res.data?.reviewLevel ?? level)
        setPendingLevel("")
        setSessions((prev) => prev.map((item) => item.id === activeSessionId ? { ...item, reviewLevel: res.data?.reviewLevel ?? level } : item))
      } else {
        setFeedback({ tone: "error", text: res?.error?.message || "切换审核档位失败" })
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setLevelBusy(false)
    }
  }, [activeSessionId])

  const pickReviewLevel = useCallback((level) => {
    if (level === reviewLevel) { setPendingLevel(""); return }
    if (level === "full_allow") { setPendingLevel(level); return }
    void applyReviewLevel(level)
  }, [reviewLevel, applyReviewLevel])

  /** v2.16 §11.3：切换会话默认预算档位；只影响之后入列的 Run，不改变运行中的 Run。 */
  const applyBudgetTier = useCallback(async (tier) => {
    if (!activeSessionId) { setFeedback({ tone: "error", text: "请先选择或创建会话" }); return }
    if (tier === budgetTier) return
    setBudgetBusy(true)
    try {
      const res = await harnessSend("harness.setBudgetTier", { sessionId: activeSessionId, branchId: branchIdRef.current, tier })
      if (res?.ok) {
        const next = res.data?.budgetTier ?? tier
        setBudgetTier(next)
        setSessions((prev) => prev.map((item) => item.id === activeSessionId ? { ...item, budgetTier: next } : item))
        setFeedback({ tone: "info", text: `运行预算：${BUDGET_OPTIONS.find((item) => item.value === next)?.label || next}（下一轮起生效）` })
      } else {
        setFeedback({ tone: "error", text: res?.error?.message || "切换运行预算失败" })
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBudgetBusy(false)
    }
  }, [activeSessionId, budgetTier])

  const renameSession = useCallback(async (sessionId, title) => {
    const trimmed = String(title || "").trim()
    if (!sessionId || !trimmed) return false
    const res = await harnessSend("harness.renameSession", { sessionId, title: trimmed })
    if (res?.ok) {
      setSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, title: trimmed } : item))
      return true
    }
    setFeedback({ tone: "error", text: res?.error?.message || "重命名失败" })
    return false
  }, [])

  const deleteSession = useCallback(async (sessionId, force = false) => {
    const res = await harnessSend("harness.deleteSession", { sessionId, force })
    if (res?.ok) {
      if (sessionId === activeSessionId) {
        setActiveSessionId("")
        setMessages([])
        setRunStatus(null)
        setContinuable(false)
        setStatus("ready")
        insightsSessionRef.current = ""
        setInsights(null)
        setInsightsState("idle")
      }
      await refreshSessions(sessionQuery)
      if (res.data?.cancelRequested) setFeedback({ tone: "info", text: "会话已删除；该会话的运行已请求取消。" })
      return { ok: true }
    }
    if (res?.error?.code === "session_running") return { ok: false, needsForce: true }
    setFeedback({ tone: "error", text: res?.error?.message || "删除会话失败" })
    return { ok: false }
  }, [activeSessionId, refreshSessions, sessionQuery])

  /** b19-4：彻底删除（物理清除消息/运行/审计/证据）。与软删除互为补充，不可恢复。 */
  const purgeSession = useCallback(async (sessionId, force = false) => {
    const res = await harnessSend("harness.purgeSession", { sessionId, force })
    if (res?.ok) {
      if (sessionId === activeSessionId) {
        setActiveSessionId("")
        setMessages([])
        setRunStatus(null)
        setContinuable(false)
        setStatus("ready")
        insightsSessionRef.current = ""
        setInsights(null)
        setInsightsState("idle")
      }
      await refreshSessions(sessionQuery)
      setFeedback({ tone: "info", text: "会话已彻底删除，本地数据库中的消息、运行与审计记录已清除。" })
      return { ok: true }
    }
    if (res?.error?.code === "session_running") return { ok: false, needsForce: true }
    setFeedback({ tone: "error", text: res?.error?.message || "彻底删除会话失败" })
    return { ok: false }
  }, [activeSessionId, refreshSessions, sessionQuery])

  const openRecord = useCallback((ref) => { setEvidenceId(""); setRecordRef(ref) }, [])
  /** b19-2b：正文里的引用未通过本轮核验（模型编造/文本异常）——不打开，给出说明。 */
  const rejectCitation = useCallback((kind) => {
    setFeedback({
      tone: "info",
      text: kind === "stat"
        ? "该统计引用未经本轮 getMistakeStats 结果核验，未打开。"
        : "该卡片引用未经本轮工具结果核验，未打开原始卡片。",
    })
  }, [])
  const openStat = useCallback((id) => {
    setRecordRef("")
    setEvidenceId(id)
  }, [])
  const closeEvidence = useCallback(() => { setEvidenceId(""); setRecordRef("") }, [])

  const toggleDiagnostic = useCallback(() => {
    setDiagnostic((prev) => {
      const next = !prev
      try { window.localStorage?.setItem(DIAGNOSTIC_KEY, next ? "1" : "0") } catch { /* 私有模式忽略 */ }
      return next
    })
  }, [])

  const exportSession = useCallback(async () => {
    if (!activeSessionId) return
    try {
      const res = await harnessSend("harness.exportSession", { sessionId: activeSessionId, branchId: branchIdRef.current, format: "markdown" })
      if (!res?.ok) { setFeedback({ tone: "error", text: res?.error?.message || "导出失败" }); return }
      const markdown = String(res.data?.markdown ?? "")
      const filename = String(res.data?.filename || "cardlink-会话.md")
      try {
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 3000)
        setFeedback({ tone: "info", text: `会话已导出：${filename}` })
      } catch {
        const copied = await import("../../components/ai/message-actions").then((m) => m.copyTextToClipboard(markdown))
        setFeedback({ tone: copied ? "info" : "error", text: copied ? "导出内容已复制到剪贴板（下载不可用）" : "导出失败" })
      }
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    }
  }, [activeSessionId])

  // 重开会话后，从已验证记录引用批量解析真实标题。
  useEffect(() => {
    if (!SCENE_READY) return
    const pending = new Set()
    for (const message of messages) {
      if (message.role !== "assistant" || Array.isArray(message.citations)) continue
      for (const ref of message.evidenceRefs || []) {
        if (typeof ref === "string" && ref && !ref.startsWith("stat:ev_") && !requestedTitleRefsRef.current.has(ref)) pending.add(ref)
      }
    }
    if (!pending.size) return
    for (const ref of pending) requestedTitleRefsRef.current.add(ref)
    let alive = true
    harnessSend("harness.resolveRecordTitles", { recordIds: [...pending] }).then((res) => {
      if (!alive || !res?.ok) return
      setRecordTitles((prev) => ({ ...prev, ...(res.data || {}) }))
    })
    return () => { alive = false }
  }, [messages])

  const activeSession = sessions.find((item) => item.id === activeSessionId)

  // v2.5 §5.2/§11.1：上下文预算、token 用量与压缩次数（运行状态或终态结果，任一处可得即可）。
  const contextUsage = (() => {
    const usage = runStatus?.usage || runStatus?.result?.usage || null
    const context = runStatus?.context || runStatus?.result?.context || null
    const compactionCount = runStatus?.compactionCount ?? context?.compactionCount ?? 0
    if (!usage && !context && !compactionCount) return null
    return { usage, context, compactionCount }
  })()

  return {
    sceneReady: SCENE_READY,
    sessions,
    sessionsLoading,
    sessionLoading,
    sessionQuery,
    setSessionQuery,
    activeSession,
    activeSessionId,
    branchView,
    selectBranch,
    pendingQuestion,
    questionBusy,
    questionError,
    answerQuestion,
    saveQuestionDraft,
    cancelQuestion,
    sessionModel,
    modelBusy,
    switchSessionModel,
    messages,
    setMessages,
    status,
    running,
    backgroundRuns,
    runStatus,
    feedback,
    continuable,
    contextUsage,
    insights,
    insightsState,
    insightsError,
    refreshInsights,
    loadOlderInsights,
    reviewLevel,
    pendingLevel,
    setPendingLevel,
    levelBusy,
    budgetTier,
    budgetBusy,
    applyBudgetTier,
    freshness,
    refreshFreshness,
    snapshot,
    diagnostic,
    recordTitles,
    evidenceId,
    recordRef,
    openSession,
    createSession,
    syncSnapshot,
    send,
    stop,
    forkTurn,
    continueTurn,
    applyReviewLevel,
    pickReviewLevel,
    renameSession,
    deleteSession,
    purgeSession,
    openRecord,
    openStat,
    rejectCitation,
    closeEvidence,
    toggleDiagnostic,
    exportSession,
    formatRelative,
  }
}
