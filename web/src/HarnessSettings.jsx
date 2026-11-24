import { OpenAILogo } from "@/components/assistant-ui/elements/logos"
import { SettingsPanelHeading, SettingsPanelRoot, SettingsPanelSection } from "@/components/assistant-ui/elements/settings-panel"
import {
  ModelSelectorContent, ModelSelectorEmpty, ModelSelectorItem, ModelSelectorList,
  ModelSelectorRoot, ModelSelectorSearch, ModelSelectorTrigger, ModelSelectorValue,
} from "@/components/assistant-ui/elements/model-selector"
import { Checkbox } from "radix-ui"
import React, { useCallback, useEffect, useId, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  DownloadIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { harnessSend } from "./lib/harnessClient"
import { inspectApiKey, presetById, presetForBaseUrl, PROVIDER_PRESETS } from "./lib/provider-presets"
import { Button } from "./components/ui/button"
import { Badge } from "./components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert"
import { Input } from "./components/ui/input"
import { Label } from "./components/ui/label"
import { Spinner } from "./components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select"
import { cn } from "./lib/harness-cn"

/**
 * §13 设置/诊断页（AI 分析设置，v2.3 一键配置）。
 *
 * 主路径：选服务商 → 粘贴 API Key → 保存并获取模型 → 选助手/审核模型 → 保存。
 * 模型列表来自 JSB 侧 `harness.listProviderModels`（§5.1.6）：请求只带认证头，
 * 不带任何错题内容；列表不可用时回退手动输入模型名。
 * 密钥只显示「已保存/未设置」，绝不回显明文（§12.1）。
 */

const PROVIDER_PROTOCOL = "openai-compatible"
const SAME_AS_ASSISTANT = "__cardlink_follow_assistant__"
const LEGACY_PROVIDER = "cardlink-device"

/** v2.5 §5.2：上下文窗口与输出上限预设（选择模型后自动填入，可手动覆盖）。 */
const CONTEXT_WINDOW_OPTIONS = [
  { value: 32 * 1024, label: "32K Token" },
  { value: 64 * 1024, label: "64K Token" },
  { value: 128 * 1024, label: "128K Token" },
  { value: 256 * 1024, label: "256K Token" },
]
const OUTPUT_OPTIONS = [8 * 1024, 16 * 1024, 32 * 1024]
const CONSERVATIVE_CAPS = { contextWindowTokens: 32 * 1024, maxOutputTokens: 8 * 1024, source: "default" }

const CAPABILITY_SOURCE_LABEL = {
  user: "用户覆盖",
  verified: "已验证预置",
  provider: "服务商目录",
  default: "保守默认",
}

/** v2.14 §22：本地费用估算的币种选项（每百万 token 单价；与密钥分离）。 */
const RATE_CURRENCIES = [
  { value: "CNY", label: "CNY · 人民币" },
  { value: "USD", label: "USD · 美元" },
  { value: "EUR", label: "EUR · 欧元" },
  { value: "JPY", label: "JPY · 日元" },
  { value: "HKD", label: "HKD · 港币" },
]

function reservedForWindow(windowTokens) {
  return Math.min(4096, Math.max(512, Math.floor(windowTokens * 0.125)))
}

/**
 * 输出上限必须给输入留出可用预算：至少保留 max(8K, 25% 窗口) 作为输入。
 * 否则 32K 窗口配 32K 输出会只剩 2K 输入预算，几乎每轮都触发压缩。
 */
function outputCeiling(windowTokens, capabilityMax) {
  const minimumInput = Math.max(8 * 1024, Math.floor(windowTokens * 0.25))
  const cap = capabilityMax ?? CONTEXT_WINDOW_OPTIONS[CONTEXT_WINDOW_OPTIONS.length - 1].value
  return Math.max(1024, Math.min(cap, windowTokens - reservedForWindow(windowTokens) - minimumInput))
}

/** 取不超过模型实际窗口的最大预设（向下取整，避免把 200K 模型误配成 256K 后超限）。 */
function floorWindow(tokens) {
  const fitting = CONTEXT_WINDOW_OPTIONS.filter((option) => option.value <= tokens)
  return fitting.length ? fitting[fitting.length - 1].value : CONTEXT_WINDOW_OPTIONS[0].value
}

function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return "—"
  return value >= 1024 ? `${Math.round(value / 1024)}K` : String(Math.round(value))
}

function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="m-0 text-[10px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function RoleAuthorization({ checked, onChange, disabled, children }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange}
        className="flex size-4 shrink-0 items-center justify-center rounded border border-input focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground">
        <Checkbox.Indicator><CheckIcon className="size-3.5" /></Checkbox.Indicator>
      </Checkbox.Root>
      <Label htmlFor={id} className="text-xs">{children}</Label>
    </div>
  )
}

function CatalogModelPicker({ id, label, models, value, onChange, disabled }) {
  const options = models.map((item) => ({ id: item.id, name: item.id }))
  return (
    <ModelSelectorRoot models={options} value={value} onValueChange={onChange}>
      <ModelSelectorTrigger id={id} aria-label={label} className="w-full justify-between" disabled={disabled}>
        <ModelSelectorValue placeholder={value || "选择模型"} />
      </ModelSelectorTrigger>
      <ModelSelectorContent align="start">
        <ModelSelectorSearch placeholder="搜索模型" />
        <ModelSelectorList>
          <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
          {options.map((option) => <ModelSelectorItem key={option.id} model={option} />)}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelectorRoot>
  )
}

export function HarnessSettings({ onBack }) {
  const ids = { baseUrl: useId(), apiKey: useId(), assistant: useId(), reviewer: useId(), contextWindow: useId(), maxOutput: useId(), rateCurrency: useId(), rateInput: useId(), rateOutput: useId() }
  const [presetId, setPresetId] = useState("deepseek")
  const [baseUrl, setBaseUrl] = useState(presetById("deepseek").baseUrl)
  const [apiKey, setApiKey] = useState("")
  const [connections, setConnections] = useState([])
  const [connectionId, setConnectionId] = useState("")
  const [reviewerConnectionId, setReviewerConnectionId] = useState("")
  const [active, setActive] = useState(null)
  const [editing, setEditing] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [assistantAuthorized, setAssistantAuthorized] = useState(false)
  const [reviewerAuthorized, setReviewerAuthorized] = useState(false)
  const [test, setTest] = useState(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [models, setModels] = useState([])
  const [modelsFetchedAt, setModelsFetchedAt] = useState("")
  const [assistantModel, setAssistantModel] = useState("")
  const [reviewerChoice, setReviewerChoice] = useState(SAME_AS_ASSISTANT)
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState(null)
  // v2.5 §5.2：模型能力（选择模型后读取；保存时作为用户覆盖写入）。
  const [capabilities, setCapabilities] = useState(null)
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false)
  const [contextWindow, setContextWindow] = useState(64 * 1024)
  const [maxOutput, setMaxOutput] = useState(16 * 1024)
  // v2.14 §22：本地费率（可选；只影响本地费用估算，不代表账单金额）。
  const [rate, setRate] = useState(null)
  const [rateCurrency, setRateCurrency] = useState("CNY")
  const [rateInput, setRateInput] = useState("")
  const [rateOutput, setRateOutput] = useState("")

  const preset = presetById(presetId)
  const keyInspect = inspectApiKey(apiKey)
  const hasCatalog = models.length > 0
  const selected = connections.find((item) => item.id === connectionId)
  const keySet = Boolean(selected?.keySet && selected.baseUrl.replace(/\/+$/, "") === baseUrl.trim().replace(/\/+$/, ""))
  const providerId = keySet ? connectionId : ""
  const reviewerId = reviewerChoice === SAME_AS_ASSISTANT ? providerId : (reviewerConnectionId || providerId)
  const needsAssistantAuthorization = Boolean(providerId && active?.assistant?.providerId !== providerId &&
    !selected?.authorizedRoles?.includes("assistant"))
  const needsReviewerAuthorization = Boolean(reviewerId && active?.reviewer?.providerId !== reviewerId &&
    !connections.find((item) => item.id === reviewerId)?.authorizedRoles?.includes("reviewer"))
  const activeConnection = connections.find((item) => item.id === active?.assistant?.providerId)
  const activeReviewerConnection = connections.find((item) => item.id === active?.reviewer?.providerId)
  const verificationOf = (role) => {
    const setting = active?.[role]
    const verified = test?.providerId === setting?.providerId && test?.model === setting?.model
      ? test?.ok
      : active?.[role + "Verification"]
    return verified === true ? "已验证" : verified === false ? "验证失败" : "未验证"
  }

  const chooseConnection = useCallback((connection) => {
    setConnectionId(connection?.id || "")
    if (connection) {
      setBaseUrl(connection.baseUrl)
      setPresetId(presetForBaseUrl(connection.baseUrl)?.id || "custom")
    }
    setApiKey("")
    setModels([])
    setModelsFetchedAt("")
    setAssistantAuthorized(false)
    setReviewerAuthorized(false)
  }, [])

  const loadCurrent = useCallback(async () => {
    try {
      const res = await harnessSend("harness.getModelSettings")
      if (!res?.ok) throw new Error(res?.error?.message || "读取 AI 设置失败")
      const { assistant, reviewer, connections: list } = res.data
      setConnections(list)
      setActive(res.data)
      chooseConnection(list.find((item) => item.id === (assistant?.providerId || LEGACY_PROVIDER)))
      setAssistantModel(assistant?.model || "")
      setReviewerChoice(!reviewer || reviewer.followsAssistant === true ||
        (reviewer.followsAssistant === undefined && reviewer.model === assistant?.model && reviewer.providerId === assistant.providerId)
        ? SAME_AS_ASSISTANT : reviewer.model)
      setReviewerConnectionId(reviewer?.providerId === assistant?.providerId ? "" : reviewer?.providerId || "")
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSettingsLoaded(true)
    }
  }, [chooseConnection])

  useEffect(() => { void loadCurrent() }, [loadCurrent])

  // v2.5 §5.2：模型名变化后读取生效能力（用户覆盖 > 已验证预置 > 保守默认），自动填入预算。
  useEffect(() => {
    const model = assistantModel.trim()
    if (!model || !providerId) { setCapabilities(null); setCapabilitiesLoading(false); return undefined }
    let cancelled = false
    setCapabilitiesLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await harnessSend("harness.getModelCapabilities", { providerId, model })
        if (cancelled) return
        const caps = res?.ok ? res.data?.capabilities : null
        setCapabilities(caps ? { ...caps, calibrationRatio: res.data?.calibrationRatio } : null)
        const windowTokens = caps?.contextWindowTokens || CONSERVATIVE_CAPS.contextWindowTokens
        const window = floorWindow(windowTokens)
        setContextWindow(window)
        const capOut = outputCeiling(window, caps?.maxOutputTokens)
        const choices = OUTPUT_OPTIONS.filter((value) => value <= capOut)
        const configured = active?.assistant
        const preferred = configured?.providerId === providerId && configured.model === model
          ? configured.maxOutputTokens
          : Math.min(16384, capOut)
        setMaxOutput(Math.min(preferred || choices[0] || capOut, capOut))
      } finally {
        if (!cancelled) setCapabilitiesLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [assistantModel, providerId, active?.assistant])

  const pickContextWindow = useCallback((value) => {
    const windowTokens = Number(value)
    setContextWindow(windowTokens)
    const capOut = outputCeiling(windowTokens, capabilities?.maxOutputTokens)
    setMaxOutput((current) => Math.min(current, capOut))
  }, [capabilities])

  // v2.14 §22：读取当前助手模型的手动费率（未选模型时退回已配置列表首项）。
  useEffect(() => {
    let current = true
    setRate(null)
    setRateInput("")
    setRateOutput("")
    const model = assistantModel.trim()
    if (providerId && model) {
      harnessSend("harness.getModelRate", { providerId, model }).then((res) => {
        if (!current || !res?.ok || !res.data?.rate) return
        const found = res.data.rate
        setRate(found)
        setRateCurrency(found.currency)
        setRateInput(String(found.inputPerMillion))
        setRateOutput(String(found.outputPerMillion))
      }).catch(() => {})
    }
    return () => { current = false }
  }, [assistantModel, providerId])

  // 窗口或能力变化后，确保当前输出值仍落在可选范围内（避免 Select 显示空值）。
  useEffect(() => {
    const cap = outputCeiling(contextWindow, capabilities?.maxOutputTokens)
    setMaxOutput((current) => (current > cap ? cap : current))
  }, [contextWindow, capabilities])

  const failNotice = useCallback((error) => {
    setNotice({ ok: false, text: error instanceof Error ? error.message : String(error) })
  }, [])

  const catalogErrorMessage = useCallback((error) => {
    const message = error?.message || "获取模型列表失败"
    if (/credential_missing/.test(message)) return "尚未保存 API Key，请先粘贴密钥。"
    if (/credential_invalid/.test(message)) return "API Key 被服务商拒绝（401/403），请检查密钥是否有效或与所选服务商匹配。"
    if (/models_unsupported/.test(message)) return "该服务商没有可用的 /models 接口，请展开「高级」确认地址，或直接手动填写模型名。"
    if (/rate_limited/.test(message)) return "请求过于频繁（429），请稍后再试。"
    if (/timeout|model_catalog_timeout/.test(message)) return "获取模型列表超时，请检查网络后重试，或手动填写模型名。"
    if (/not_available/.test(message)) return "当前宿主未提供模型目录能力，请手动填写模型名。"
    return message
  }, [])

  const applyPreset = useCallback((nextId) => {
    const next = presetById(nextId)
    setPresetId(nextId)
    setBaseUrl(next.baseUrl)
    setModels([])
    setModelsFetchedAt("")
    if (next.defaultModel) setAssistantModel(next.defaultModel)
    setReviewerChoice(SAME_AS_ASSISTANT)
    setReviewerConnectionId("")
    setAssistantAuthorized(false)
    setReviewerAuthorized(false)
    setApiKey("")
    setNotice(null)
  }, [])

  const fetchModels = useCallback(async (id) => {
    const res = await harnessSend("harness.listProviderModels", { providerId: id })
    if (!res?.ok) throw new Error(res?.error?.message || "获取模型列表失败")
    const list = Array.isArray(res.data?.models) ? res.data.models : []
    setModels(list)
    setModelsFetchedAt(res.data?.fetchedAt || "")
    const idsInList = list.map((item) => item.id)
    setAssistantModel((current) => {
      if (current && idsInList.includes(current)) return current
      const fallback = [preset.defaultModel, idsInList[0]].find((candidate) => candidate && idsInList.includes(candidate))
      return fallback || idsInList[0] || current
    })
    return list
  }, [preset.defaultModel])

  const refreshModels = useCallback(async () => {
    setBusy("refresh")
    setNotice(null)
    try {
      const list = await fetchModels(providerId)
      setNotice({ ok: true, text: list.length ? `已获取 ${list.length} 个模型。` : "目录为空，可手动填写模型名。" })
    } catch (error) {
      setNotice({ ok: false, text: catalogErrorMessage(error) })
    } finally {
      setBusy("")
    }
  }, [providerId, fetchModels, catalogErrorMessage])

  const connect = useCallback(async () => {
    setBusy("connect")
    setNotice(null)
    try {
      const res = await harnessSend("harness.saveModelConnection", { connectionId, baseUrl, apiKey })
      if (!res?.ok) throw new Error(res?.error?.message || "保存连接失败")
      const { connection } = res.data
      chooseConnection(connection)
      setConnections((items) => {
        const before = items.find((item) => item.id === connection.id)
        return [...items.filter((item) => item.id !== connection.id), { ...before, ...connection }]
      })
      setTest((previous) => previous?.providerId === connection.id ? null : previous)
      setActive((previous) => previous && {
        ...previous,
        assistantVerification: previous.assistant?.providerId === connection.id ? null : previous.assistantVerification,
        reviewerVerification: previous.reviewer?.providerId === connection.id ? null : previous.reviewerVerification,
      })
      setNotice({ ok: true, text: "连接已保存。可获取模型列表，或手动填写模型名。" })
    } catch (error) {
      failNotice(error)
    } finally {
      setApiKey("")
      setBusy("")
    }
  }, [connectionId, baseUrl, apiKey, chooseConnection, failNotice])

  const saveModels = useCallback(async () => {
    setBusy("models")
    setNotice(null)
    try {
      const followsAssistant = reviewerChoice === SAME_AS_ASSISTANT
      const res = await harnessSend("harness.activateModelRoles", {
        assistant: { providerId, model: assistantModel, maxOutputTokens: maxOutput, authorized: assistantAuthorized },
        reviewer: { providerId: reviewerId, model: reviewerChoice, followsAssistant, authorized: reviewerAuthorized },
      })
      if (!res?.ok) throw new Error(res?.error?.message || "启用模型失败")
      setActive(res.data)
      setConnections((items) => items.map((item) => {
        const roles = new Set(item.authorizedRoles)
        if (item.id === providerId) roles.add("assistant")
        if (item.id === reviewerId) roles.add("reviewer")
        return { ...item, authorizedRoles: [...roles] }
      }))
      setEditing(false)
      setAssistantAuthorized(false)
      setReviewerAuthorized(false)
      setNotice({ ok: true, text: "默认模型已启用。新会话将使用所选助手模型。" })
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [providerId, assistantModel, maxOutput, assistantAuthorized, reviewerId, reviewerChoice, reviewerAuthorized, failNotice])

  const saveCapabilities = useCallback(async () => {
    setBusy("capabilities")
    try {
      const res = await harnessSend("harness.setModelCapabilities", {
        providerId,
        modelId: assistantModel.trim(),
        contextWindowTokens: contextWindow,
        maxOutputTokens: maxOutput,
        supportsToolCalls: capabilities?.supportsToolCalls !== false,
        supportsUsage: capabilities?.supportsUsage === true,
      })
      if (!res?.ok) throw new Error(res?.error?.message || "保存模型能力失败")
      setNotice({ ok: true, text: "该模型的上下文和输出预算已保存。" })
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [providerId, assistantModel, contextWindow, maxOutput, capabilities, failNotice])

  const clearKey = useCallback(async () => {
    setBusy("clear")
    setNotice(null)
    try {
      const res = await harnessSend("harness.clearCredential", { credentialRef: selected.credentialRef })
      if (!res?.ok) throw new Error(res?.error?.message || "清除失败")
      setConnections((items) => items.map((item) => item.id === connectionId ? { ...item, keySet: false } : item))
      setTest((previous) => previous?.providerId === connectionId ? null : previous)
      setModels([])
      setModelsFetchedAt("")
      setNotice({ ok: true, text: "此连接的密钥已清除。关联会话需重新保存密钥才能发起请求。" })
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [connectionId, selected, failNotice])

  const testProvider = useCallback(async (role) => {
    setBusy("test-" + role)
    setNotice(null)
    const id = role === "assistant" ? providerId : reviewerId
    const model = (role === "assistant" ? assistantModel : reviewerChoice).trim()
    try {
      const res = await harnessSend("harness.testModelProvider", { providerId: id, role, model })
      if (!res?.ok || res.data?.reachable !== true) throw new Error(res?.error?.message || "服务商的探测回复不符合预期")
      setTest({ providerId: id, model, ok: true })
      setNotice({ ok: true, text: `测试通过：${model}` })
    } catch (error) {
      setTest({ providerId: id, model, ok: false })
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [assistantModel, providerId, reviewerChoice, reviewerId, failNotice])

  /** v2.14 §22：保存手动费率（每百万 token 单价；币种随费率保存）。 */
  const saveRate = useCallback(async () => {
    setBusy("rate")
    setNotice(null)
    try {
      const model = assistantModel.trim()
      if (!model) throw new Error("请先选择或填写助手模型，再配置该模型的费率")
      const input = Number(rateInput)
      const output = Number(rateOutput)
      if (!rateInput.trim() || !Number.isFinite(input) || input < 0) throw new Error("输入 token 单价必须是不小于 0 的数值")
      if (!rateOutput.trim() || !Number.isFinite(output) || output < 0) throw new Error("输出 token 单价必须是不小于 0 的数值")
      const res = await harnessSend("harness.setModelRate", {
        providerId,
        model,
        currency: rateCurrency,
        inputPerMillion: input,
        outputPerMillion: output,
      })
      if (!res?.ok) throw new Error(res?.error?.message || "保存费率失败")
      setRate(res.data || null)
      setNotice({ ok: true, text: `已保存 ${model} 的本地费率（${rateCurrency}，每百万输入 ${input} / 输出 ${output}）。` })
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [assistantModel, providerId, rateCurrency, rateInput, rateOutput, failNotice])

  const clearRate = useCallback(async () => {
    setBusy("rate")
    setNotice(null)
    try {
      const model = assistantModel.trim() || rate?.model || ""
      if (!model) throw new Error("没有可清除的费率")
      const res = await harnessSend("harness.clearModelRate", { providerId, model })
      if (!res?.ok) throw new Error(res?.error?.message || "清除费率失败")
      setRate(null)
      setRateInput("")
      setRateOutput("")
      setNotice({ ok: true, text: "已清除本地费率；费用将显示为缺失，不再估算金额。" })
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy("")
    }
  }, [assistantModel, providerId, rate, failNotice])

  const anyBusy = Boolean(busy) || !settingsLoaded
  const reservedTokens = reservedForWindow(contextWindow)
  const inputBudgetTokens = Math.max(0, contextWindow - maxOutput - reservedTokens)
  const outputCap = outputCeiling(contextWindow, capabilities?.maxOutputTokens)
  const outputChoices = [...new Set([...OUTPUT_OPTIONS.filter((value) => value <= outputCap), Math.min(maxOutput, outputCap)])].sort((a, b) => a - b)

  return (
    <div className="agentSettings harness-ui" data-scene="true">
      <div className="agentSettingsBar">
        <Button variant="ghost" size="sm" className="agentBackButton" onClick={onBack}>
          <ChevronLeftIcon />
          返回设置
        </Button>
        <Badge variant={activeConnection?.keySet ? "secondary" : "outline"} className="gap-1">
          {activeConnection?.keySet ? <ShieldCheckIcon className="size-3" /> : <ShieldAlertIcon className="size-3" />}
          {activeConnection?.keySet ? "已启用连接" : "无可用默认连接"}
        </Badge>
      </div>

      <header className="agentSettingsIntro">
        <h2 className="m-0 text-base font-semibold">AI 分析设置</h2>
        <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
          管理 AI 助手、审核模型及其服务商连接。
        </p>
      </header>

      {notice ? (
        <Alert variant={notice.ok ? "success" : "destructive"} role={notice.ok ? "status" : "alert"}>
          <AlertDescription className={cn("text-xs", notice.ok ? "text-[var(--mn-level-2,#248a3d)]" : "text-destructive")}>
            {notice.text}
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsPanelRoot className="max-w-none">
      {active?.assistant ? (
        <section aria-label="生效配置" className="flex flex-wrap items-center justify-between gap-3">
          <dl className="grid gap-1 text-sm">
            <div><dt className="inline text-muted-foreground">默认助手 </dt><dd className="inline">{active.assistant.model}</dd></div>
            <div><dt className="inline text-muted-foreground">审核模型 </dt><dd className="inline">{active.reviewer?.followsAssistant ? "跟随助手" : active.reviewer?.model || "未配置"}</dd></div>
            <div><dt className="inline text-muted-foreground">助手连接 </dt><dd className="inline">{activeConnection?.keySet ? verificationOf("assistant") : "缺少密钥"}</dd></div>
            {active.reviewer && !active.reviewer.followsAssistant ? (
              <div><dt className="inline text-muted-foreground">审核连接 </dt><dd className="inline">{activeReviewerConnection?.keySet ? verificationOf("reviewer") : "缺少密钥"}</dd></div>
            ) : null}
          </dl>
          <Button variant="outline" size="sm" disabled={anyBusy} onClick={() => {
            if (editing) { void loadCurrent(); setEditing(false) }
            else setEditing(true)
          }}>{editing ? "取消编辑" : "编辑配置"}</Button>
        </section>
      ) : null}

      {!settingsLoaded && <p role="status" className="text-sm text-muted-foreground">正在读取 AI 设置…</p>}
      {(!active?.assistant || editing) && settingsLoaded ? <>
      <SettingsPanelSection className="gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
        <header className="flex flex-col gap-1">
          <SettingsPanelHeading className="text-xs">
            服务商连接
          </SettingsPanelHeading>
          <p className="m-0 text-[11px] text-muted-foreground">选择已有连接，或填写接口地址与密钥保存新连接。</p>
        </header>
        <div className="flex flex-col gap-2.5">
          {connections.length ? (
            <Field label="已有连接" htmlFor={ids.baseUrl + "-saved"}>
              <Select value={connectionId || ""} onValueChange={(id) => {
                chooseConnection(connections.find((item) => item.id === id))
                setAssistantModel(active?.assistant?.providerId === id ? active.assistant.model : "")
              }} disabled={anyBusy}>
                <SelectTrigger id={ids.baseUrl + "-saved"} className="w-full"><SelectValue placeholder="选择连接" /></SelectTrigger>
                <SelectContent position="popper">
                  {connections.map((item) => <SelectItem key={item.id} value={item.id}>{item.baseUrl}{item.keySet ? "" : "（缺少密钥）"}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <div className="agentPresetRow" role="radiogroup" aria-label="模型服务商">
            {PROVIDER_PRESETS.map((item) => {
              const active = presetId === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn("agentPresetChip", active && "active")}
                  onClick={() => applyPreset(item.id)}
                  disabled={anyBusy}
                >
                  {item.id === "openai" ? <OpenAILogo aria-hidden className="me-1 inline size-3" /> : null}
                  {item.label}
                </button>
              )
            })}
          </div>
          <p className="m-0 text-[10px] leading-relaxed text-muted-foreground">
            {preset.note}
            {preset.baseUrl ? ` · ${preset.baseUrl}/models` : " · 需在高级里填写 https 接口地址"}
          </p>

          <Field
            label="API Key"
            htmlFor={ids.apiKey}
            hint={keySet ? "已保存密钥；输入框始终为空，重新填写可更换。" : "只在本机 Harness 数据库保存（混淆存储，非 Keychain 级加密），可随时清除。"}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={ids.apiKey}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={keySet ? "••••••••（已保存）" : presetId === "openai" ? "sk-…" : "粘贴服务商控制台里的 API Key"}
                autoComplete="new-password"
                spellCheck={false}
                disabled={anyBusy}
              />
              <Button size="sm" className="shrink-0" onClick={connect} disabled={anyBusy || !apiKey.trim()}>
                {busy === "connect" ? <Spinner /> : <DownloadIcon />}
                {keySet ? "更新密钥" : "保存连接"}
              </Button>
            </div>
          </Field>

          {keyInspect.presetId && keyInspect.presetId !== presetId ? (
            <p className="m-0 text-[10px] text-muted-foreground">
              这个密钥看起来属于 {presetById(keyInspect.presetId).label}，
              <button type="button" className="agentInlineLink" onClick={() => applyPreset(keyInspect.presetId)}>切换服务商</button>
            </p>
          ) : null}
          {keyInspect.warning ? <Alert variant="info" role="note"><AlertDescription className="text-[11px]">{keyInspect.warning}</AlertDescription></Alert> : null}

          <button
            type="button"
            className="agentAdvancedToggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
            高级：接口地址与协议
          </button>
          {advancedOpen ? (
            <div className="flex flex-col gap-2.5">
              <Field
                label="接口地址（Base URL）"
                htmlFor={ids.baseUrl}
                hint="只支持 https；模型目录会请求 {该地址}/models。自建网关或代理时填写。"
              >
                <Input
                  id={ids.baseUrl}
                  value={baseUrl}
                  onChange={(event) => { setPresetId("custom"); setBaseUrl(event.target.value) }}
                  placeholder="https://api.deepseek.com"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  disabled={anyBusy}
                />
              </Field>
              <p className="agentSettingsRowFacts">
                <span><em>协议</em><b>{PROVIDER_PROTOCOL}</b></span>
              </p>
            </div>
          ) : null}
        </div>
      </SettingsPanelSection>

      <SettingsPanelSection className="gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
        <header className="flex flex-col gap-1">
          <SettingsPanelHeading className="text-xs">
            模型
          </SettingsPanelHeading>
          <p className="m-0 text-[11px] text-muted-foreground">
            {hasCatalog
              ? `已从服务商获取 ${models.length} 个模型${modelsFetchedAt ? ` · ${new Date(modelsFetchedAt).toLocaleTimeString()}` : ""}`
              : "获取模型列表或手动填写模型名。"}
          </p>
        </header>
        <div className="flex flex-col gap-2.5">
          <Field label="助手模型" htmlFor={ids.assistant}>
            {hasCatalog ? (
              <CatalogModelPicker id={ids.assistant + "-catalog"} label="模型目录" models={models} value={assistantModel} onChange={setAssistantModel} disabled={anyBusy} />
            ) : null}
            <Input id={ids.assistant} value={assistantModel} onChange={(event) => setAssistantModel(event.target.value)}
              placeholder={preset.defaultModel || "手动填写模型名"} autoComplete="off" spellCheck={false} disabled={anyBusy} />
          </Field>

          <Field label="审核连接" htmlFor={ids.reviewer + "-connection"}>
            <Select value={reviewerChoice === SAME_AS_ASSISTANT ? SAME_AS_ASSISTANT : (reviewerConnectionId || providerId || "assistant-connection")}
              onValueChange={(id) => {
                setReviewerConnectionId(id === SAME_AS_ASSISTANT || id === "assistant-connection" ? "" : id)
                setReviewerChoice(id === SAME_AS_ASSISTANT ? SAME_AS_ASSISTANT : "")
                setReviewerAuthorized(false)
              }} disabled={anyBusy}>
              <SelectTrigger id={ids.reviewer + "-connection"} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={SAME_AS_ASSISTANT}>跟随助手</SelectItem>
                {!providerId ? <SelectItem value="assistant-connection">与助手共用连接</SelectItem> : null}
                {connections.map((item) => <SelectItem key={item.id} value={item.id} disabled={!item.keySet}>{item.baseUrl}{item.id === providerId ? "（助手连接）" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {reviewerChoice !== SAME_AS_ASSISTANT ? (
            <Field label="审核模型" htmlFor={ids.reviewer}>
              {hasCatalog && reviewerId === providerId ? (
                <CatalogModelPicker id={ids.reviewer + "-catalog"} label="模型目录" models={models} value={reviewerChoice} onChange={setReviewerChoice} disabled={anyBusy} />
              ) : null}
              <Input id={ids.reviewer} value={reviewerChoice} onChange={(event) => setReviewerChoice(event.target.value)}
                autoComplete="off" spellCheck={false} disabled={anyBusy} />
            </Field>
          ) : null}

          {needsAssistantAuthorization ? (
            <RoleAuthorization checked={assistantAuthorized} disabled={anyBusy} onChange={setAssistantAuthorized}>
              允许助手连接接收分析所需的错题数据
            </RoleAuthorization>
          ) : null}
          {needsReviewerAuthorization ? (
            <RoleAuthorization checked={reviewerAuthorized} disabled={anyBusy} onChange={setReviewerAuthorized}>
              允许审核连接接收审核所需的错题摘要
            </RoleAuthorization>
          ) : null}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field
              label="模型上下文窗口"
              htmlFor={ids.contextWindow}
              hint="选择模型后自动填入；未知模型按 32K 保守默认，可手动覆盖。"
            >
              <Select value={String(contextWindow)} onValueChange={pickContextWindow} disabled={anyBusy}>
                <SelectTrigger id={ids.contextWindow} className="w-full" aria-label="模型上下文窗口">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {CONTEXT_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="助手最大输出 Token"
              htmlFor={ids.maxOutput}
              hint="常规分析 16,384；详细解题可选 32,768。实际生效值不超过模型上限。"
            >
              <Select value={String(maxOutput)} onValueChange={(value) => setMaxOutput(Number(value))} disabled={anyBusy}>
                <SelectTrigger id={ids.maxOutput} className="w-full" aria-label="助手最大输出 Token">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {outputChoices.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value >= 32768 ? `${value / 1024}（详细模式）` : value / 1024}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="agentSettingsRowFacts">
            <span><em>最大输入预算</em><b>{formatTokens(inputBudgetTokens)}</b></span>
            <span><em>最大输出</em><b>{formatTokens(maxOutput)}</b></span>
            <span><em>安全余量</em><b>{formatTokens(reservedTokens)}</b></span>
          </p>
          <p className="m-0 text-[10px] leading-relaxed text-muted-foreground">
            自动压缩在有效输入估算超过输入预算的 85% 时触发。有效输入包含已有摘要、保留的对话和模型所需的指令与工具定义。
            {capabilities
              ? ` 能力来源：${CAPABILITY_SOURCE_LABEL[capabilities.source] || capabilities.source}${capabilities.calibrationRatio ? ` · 估算校准 ×${capabilities.calibrationRatio}` : ""}`
              : capabilitiesLoading
                ? " 正在读取模型能力…"
                : " 尚未读取模型能力，使用保守默认。"}
            预算按所选参数计算，实际请求仍受服务商能力限制。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveModels} disabled={anyBusy || !providerId || !assistantModel.trim() ||
              (reviewerChoice !== SAME_AS_ASSISTANT && !reviewerChoice.trim()) ||
              (needsAssistantAuthorization && !assistantAuthorized) || (needsReviewerAuthorization && !reviewerAuthorized)}>
              {busy === "models" ? <Spinner /> : null}
              保存并启用
            </Button>
            <Button size="sm" variant="outline" onClick={() => testProvider("assistant")} disabled={anyBusy || !providerId || !assistantModel.trim()}>
              {busy === "test-assistant" ? <Spinner /> : null}
              测试连接
            </Button>
            {reviewerChoice !== SAME_AS_ASSISTANT ? (
              <Button size="sm" variant="outline" onClick={() => testProvider("reviewer")} disabled={anyBusy || !reviewerId || !reviewerChoice.trim()}>
                {busy === "test-reviewer" ? <Spinner /> : null}
                测试审核连接
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={refreshModels} disabled={anyBusy || !keySet}>
              {busy === "refresh" ? <Spinner /> : null}
              获取模型列表
            </Button>
            <Button size="sm" variant="ghost" onClick={saveCapabilities} disabled={anyBusy || !providerId || !assistantModel.trim()}>
              保存模型预算
            </Button>
          </div>
        </div>
      </SettingsPanelSection>

      <SettingsPanelSection className="gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
        <header className="flex flex-col gap-1">
          <SettingsPanelHeading className="text-xs">
            费用估算（可选）
          </SettingsPanelHeading>
          <p className="m-0 text-[11px] text-muted-foreground">
            为当前助手模型填写每百万 token 单价，AI 对话页的「上下文」面板会据此在本地估算花费。
            只影响显示，不改变模型调用，也不联网取价。
          </p>
        </header>
        <div className="flex flex-col gap-2.5">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Field label="币种" htmlFor={ids.rateCurrency} hint="不同币种分开累计，不混算。">
              <Select value={rateCurrency} onValueChange={setRateCurrency} disabled={anyBusy}>
                <SelectTrigger id={ids.rateCurrency} className="w-full" aria-label="计费币种">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {RATE_CURRENCIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="输入 token 单价" htmlFor={ids.rateInput} hint="每百万输入 token 的价格，可填 0。">
              <Input
                id={ids.rateInput}
                value={rateInput}
                onChange={(event) => setRateInput(event.target.value)}
                placeholder="例如 2"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                disabled={anyBusy}
              />
            </Field>
            <Field label="输出 token 单价" htmlFor={ids.rateOutput} hint="每百万输出 token 的价格，可填 0。">
              <Input
                id={ids.rateOutput}
                value={rateOutput}
                onChange={(event) => setRateOutput(event.target.value)}
                placeholder="例如 8"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                disabled={anyBusy}
              />
            </Field>
          </div>
          <p className="agentSettingsRowFacts">
            <span><em>适用模型</em><b>{assistantModel.trim() || "未选择"}</b></span>
            <span>
              <em>当前费率</em>
              <b>{rate ? `${rate.currency} ${rate.inputPerMillion} / ${rate.outputPerMillion}` : "未配置（费用显示为缺失）"}</b>
            </span>
            <span><em>连接</em><b>{selected?.baseUrl || "未选择"}</b></span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveRate} disabled={anyBusy || !providerId || !assistantModel.trim()}>
              {busy === "rate" ? <Spinner /> : null}
              保存费率
            </Button>
            <Button size="sm" variant="outline" onClick={clearRate} disabled={anyBusy || !providerId || !rate}>
              清除费率
            </Button>
          </div>
          <p className="m-0 text-[10px] leading-relaxed text-muted-foreground">
            费率保存在本机 Harness 数据库，与 API Key 分开。费用按每次请求当时保存的费率快照估算，
            修改费率不会改写历史记录；仅统计 Assistant 请求，未计缓存折扣、额度或余额。
          </p>
        </div>
      </SettingsPanelSection>

      <SettingsPanelSection className="gap-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
        <header className="flex flex-col gap-1">
          <SettingsPanelHeading className="text-xs">
            密钥与隐私
          </SettingsPanelHeading>
          <p className="m-0 text-[11px] text-muted-foreground">
            密钥保存在本机 Harness 数据库（每安装随机密钥做流加密混淆，非 Keychain 级加密）。
            设备备份/同步文件会包含混淆后的密钥；模型目录请求只带认证头，不含任何错题内容。
          </p>
        </header>
        <div>
          <Button size="sm" variant="outline" onClick={clearKey} disabled={anyBusy || !keySet}>
            {busy === "clear" ? <Spinner /> : null}
            清除已保存密钥
          </Button>
        </div>
      </SettingsPanelSection>

      </> : null}
      </SettingsPanelRoot>

      <Alert variant="info" role="note">
        <AlertTitle>使用前需要知道</AlertTitle>
        <AlertDescription>
          <p className="m-0">首次使用前请先在「错题总览 → AI 数据报告」同步错题快照；分析过程只读取快照。</p>
          <p className="m-0">审核档位在 AI 分析输入框下方切换：严格审核、溯源免审（默认）、完全允许；任何档位都不改变数据发送范围。</p>
        </AlertDescription>
      </Alert>
    </div>
  )
}
