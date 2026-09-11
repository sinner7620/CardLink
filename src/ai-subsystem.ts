import { MN, NSJSONReadingOptions, getLocalDataByKey, isNSNull, isfileExists, setLocalDataByKey, popup, UIAlertViewStyle, writeTextFile, readJSON, delay } from "marginnote"
import { loadMistakeState } from "./mistake-store"
import { createMistakeContentReader, openSourceByMistakeId } from "./mistake-manager"
import { cardHtmlToMarkdown } from "./card-markdown"
import { decodeBase64Ascii, decodeBase64Utf8, imageExtensionFromSource } from "./base64"
import { sha256Hex } from "./content-fingerprint"
import { isMindMapNotebook } from "./note-tree"
import { REPORT_FORMAT_INSTRUCTION, REPORT_SCHEMA, extractAIOutputText, parseAIReport } from "./ai-report"
import { mineruDoneResults, mineruFailureMessage, mineruMissingDoneArchive, mineruResultItems, mineruServiceError, mineruStateSummary } from "./mineru-response"
import { cardLinkDocumentPath, cardLinkTempPath } from "./storage-paths"

const SETTINGS_KEY = "mn4-answer-matcher.ai.settings.v1"
const CREDENTIALS_KEY = "mn4-answer-matcher.ai.credentials.v1"
const MAX_RECORDS = 300
type ProviderType = "openai" | "deepseek"
type Frequency = "daily" | "weekly" | "monthly"
type OCREngine = "mineru" | "glm-ocr"

export interface AIProfile { id: string; name: string; type: ProviderType; baseUrl: string; model: string; timeoutMs: number; credentialRef: string }
export interface AISchedule { enabled: boolean; frequency: Frequency; hour: number; weekday: number; monthday: number; lastRunAt?: string }
export interface AISubject { id: string; name: string; studySetIds: string[]; schedule: AISchedule }
export interface AISettings {
  schemaVersion: 1; enabled: boolean; defaultProfileId: string; profiles: AIProfile[]; subjects: AISubject[]
  ocrEngine: OCREngine
  mineru: { enabled: boolean; baseUrl: string; credentialRef: string; model: "vlm"; language: string; enableFormula: boolean; enableTable: boolean; policy: "auto" | "all" | "image-only" | "never" }
  glmOcr: { baseUrl: string; credentialRef: string; model: "glm-ocr"; timeoutMs: number }
  privacy: { includeAnswer: boolean; includeSourcePath: boolean; includeReviewHistory: boolean; includeCustomCategories: boolean; images: "when-needed" | "always" | "never"; handwriting: boolean; mindMapHandwriting: boolean }
}

const DEFAULTS: AISettings = {
  schemaVersion: 1, enabled: false, defaultProfileId: "openai-main",
  profiles: [
    { id: "openai-main", name: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5", timeoutMs: 60000, credentialRef: "llm-openai-main" },
    { id: "deepseek-main", name: "DeepSeek", type: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", timeoutMs: 60000, credentialRef: "llm-deepseek-main" }
  ], subjects: [],
  ocrEngine: "mineru",
  mineru: { enabled: false, baseUrl: "https://mineru.net", credentialRef: "ocr-mineru", model: "vlm", language: "ch", enableFormula: true, enableTable: true, policy: "auto" },
  glmOcr: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", credentialRef: "ocr-glm", model: "glm-ocr", timeoutMs: 120000 },
  privacy: { includeAnswer: true, includeSourcePath: true, includeReviewHistory: true, includeCustomCategories: true, images: "when-needed", handwriting: false, mindMapHandwriting: false }
}
let cached: AISettings | undefined
let sessionCredentials: Record<string, string> = {}

function text(value: unknown, max = 120) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max) }
function strings(value: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).map((item: any) => text(item, 200)).filter(Boolean))) }
function schedule(value: any): AISchedule {
  return { enabled: value?.enabled === true, frequency: ["daily", "weekly", "monthly"].includes(value?.frequency) ? value.frequency : "weekly", hour: Math.min(23, Math.max(0, Number(value?.hour) || 9)), weekday: Math.min(6, Math.max(0, Number(value?.weekday) || 1)), monthday: Math.min(28, Math.max(1, Number(value?.monthday) || 1)), lastRunAt: value?.lastRunAt ? String(value.lastRunAt) : undefined }
}
function normalize(value: any): AISettings {
  const profiles: AIProfile[] = (Array.isArray(value?.profiles) ? value.profiles : DEFAULTS.profiles).map((item: any, index: number): AIProfile => {
    const type: ProviderType = item?.type === "deepseek" ? "deepseek" : "openai", id = text(item?.id, 80) || `${type}-${index + 1}`
    return { id, type, name: text(item?.name, 60) || (type === "openai" ? "OpenAI" : "DeepSeek"), baseUrl: String(item?.baseUrl || (type === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com")).replace(/\/+$/, ""), model: text(item?.model, 120) || (type === "openai" ? "gpt-5" : "deepseek-v4-pro"), timeoutMs: Math.min(180000, Math.max(10000, Number(item?.timeoutMs) || 60000)), credentialRef: text(item?.credentialRef, 100) || `llm-${id}` }
  })
  const claimed = new Set<string>()
  const subjects = (Array.isArray(value?.subjects) ? value.subjects : []).map((item: any, index: number): AISubject => {
    const studySetIds = strings(item?.studySetIds).filter(id => !claimed.has(id)); studySetIds.forEach(id => claimed.add(id))
    return { id: text(item?.id, 80) || `subject-${index + 1}`, name: text(item?.name, 60) || `科目 ${index + 1}`, studySetIds, schedule: schedule(item?.schedule) }
  })
  const mineru = value?.mineru || {}, glmOcr = value?.glmOcr || {}, privacy = value?.privacy || {}
  return { schemaVersion: 1, enabled: value?.enabled === true, defaultProfileId: profiles.some(item => item.id === value?.defaultProfileId) ? value.defaultProfileId : profiles[0]?.id || "", profiles, subjects,
    ocrEngine: value?.ocrEngine === "glm-ocr" ? "glm-ocr" : "mineru",
    mineru: { ...DEFAULTS.mineru, ...mineru, enabled: mineru.enabled === true, baseUrl: String(mineru.baseUrl || DEFAULTS.mineru.baseUrl).replace(/\/+$/, ""), policy: ["auto", "all", "image-only", "never"].includes(mineru.policy) ? mineru.policy : "auto", enableFormula: mineru.enableFormula !== false, enableTable: mineru.enableTable !== false },
    glmOcr: { ...DEFAULTS.glmOcr, ...glmOcr, baseUrl: String(glmOcr.baseUrl || DEFAULTS.glmOcr.baseUrl).replace(/\/+$/, "").replace(/\/layout_parsing$/i, ""), model: "glm-ocr", timeoutMs: Math.min(180000, Math.max(10000, Number(glmOcr.timeoutMs) || 120000)) },
    privacy: { includeAnswer: privacy.includeAnswer !== false, includeSourcePath: privacy.includeSourcePath !== false, includeReviewHistory: privacy.includeReviewHistory !== false, includeCustomCategories: privacy.includeCustomCategories !== false, images: ["when-needed", "always", "never"].includes(privacy.images) ? privacy.images : "when-needed", handwriting: privacy.handwriting === true, mindMapHandwriting: privacy.mindMapHandwriting === true } }
}
export function loadAISettings() { return cached ||= normalize(getLocalDataByKey(SETTINGS_KEY)) }
function saveAISettings(value: unknown) { cached = normalize(value); setLocalDataByKey(cached, SETTINGS_KEY); return cached }
/** AI 运行时总闸：仪表盘据此向 Web 通报是否装载 AI 模块，AI 代码在开启前零执行。 */
export function aiRuntimeEnabled(): boolean { return loadAISettings().enabled }
function persistentCredentials(): Record<string, string> { const value = getLocalDataByKey(CREDENTIALS_KEY); return value && typeof value === "object" ? value as Record<string, string> : {} }
function secret(ref: string) { return sessionCredentials[ref] || persistentCredentials()[ref] }
function secretStatus(ref: string) { const session = sessionCredentials[ref], local = persistentCredentials()[ref], value = session || local || ""; return { configured: !!value, persistence: local ? "local" : session ? "session" : "none", maskedSuffix: value.slice(-4) } }
function publicSettings() { const settings = loadAISettings(); return { ...settings, credentials: Object.fromEntries([...settings.profiles.map(item => item.credentialRef), settings.mineru.credentialRef, settings.glmOcr.credentialRef].map(ref => [ref, secretStatus(ref)])) } }

const AI_DEVELOPMENT_WARNING = "此功能正在开发测试中，暂不保证功能可用性。若启用后插件运行异常，请及时关闭该功能总开关。若有功能建议或问题欢迎反馈。"

/**
 * UIAlertView 没有公开的 destructive 按钮参数。它仍会创建原生 UIButton，
 * 因此在弹窗完成布局后按标题找到“我就试试”，只把该按钮着成系统危险红。
 */
function tintAlertButton(root: any, title: string): void {
  if (!root) return
  const queue = [root]
  while (queue.length) {
    const view = queue.shift()
    if (!view) continue
    const currentTitle = String(view.currentTitle ?? view.titleLabel?.text ?? "")
    if (currentTitle === title && typeof view.setTitleColorForState === "function") {
      view.setTitleColorForState(UIColor.colorWithHexString("#FF3B30"), 0)
      return
    }
    const subviews = view.subviews
    const count = Number(typeof subviews?.count === "function" ? subviews.count() : subviews?.count ?? subviews?.length ?? 0)
    for (let index = 0; index < count; index++) {
      const child = typeof subviews?.objectAtIndex === "function" ? subviews.objectAtIndex(index) : subviews[index]
      if (child) queue.push(child)
    }
  }
}

/** 每次进入 AI 配置页都由 MarginNote 原生弹窗明确确认。 */
export function confirmAIDevelopmentWarning(): Promise<{ confirmed: boolean }> {
  return new Promise(resolve => {
    const alertView = (UIAlertView as any).showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
      "AI 功能提示",
      AI_DEVELOPMENT_WARNING,
      UIAlertViewStyle.Default,
      "返回",
      ["我就试试"],
      (_alert: any, buttonIndex: number) => resolve({ confirmed: buttonIndex === 1 })
    )
    tintAlertButton(alertView, "我就试试")
    void delay(0.05).then(() => tintAlertButton(alertView, "我就试试"))
  })
}

/** MarginNote 的原生回调与 Foundation JSON 都可能用 NSNull 代替 JS null。 */
export function isNativeNull(value: any): boolean { return value == null || isNSNull(value) }

/** Foundation JSON 会把 JSON null 桥接为 NSNull；递归转换后再进入业务逻辑与 Web 桥。 */
export function normalizeNativeJSON(value: any): any {
  if (isNativeNull(value)) return null
  if (Array.isArray(value)) return value.map(normalizeNativeJSON)
  if (typeof value !== "object") return value
  const output: Record<string, any> = {}
  for (const key of Object.keys(value)) output[key] = normalizeNativeJSON(value[key])
  return output
}

function nativeErrorMessage(error: any): string {
  if (isNativeNull(error)) return ""
  for (const candidate of [error?.localizedDescription, error?.message]) {
    if (!isNativeNull(candidate) && typeof candidate === "string" && candidate.trim()) return text(candidate, 240)
  }
  const fallback = String(error)
  return fallback === "[object NSNull]" ? "网络请求失败" : text(fallback, 240) || "网络请求失败"
}

function responseError(json: any, status: number): string {
  for (const candidate of [json?.error?.message, json?.message, json?.msg, json?.error?.type, json?.error?.code]) {
    if (typeof candidate === "string" && candidate.trim()) return text(candidate, 240)
  }
  return `HTTP ${status || "无响应"}`
}

function http(method: string, url: string, options: { headers?: Record<string, string>; json?: any; data?: any; timeoutMs?: number } = {}): Promise<{ status: number; json?: any; data?: any }> {
  return new Promise((resolve, reject) => { try {
    const request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(url)); request.setHTTPMethod(method); request.setTimeoutInterval((options.timeoutMs || 60000) / 1000)
    for (const [key, value] of Object.entries(options.headers || {})) request.setValueForHTTPHeaderField(value, key)
    if (options.json !== undefined) { request.setValueForHTTPHeaderField("application/json", "Content-Type"); request.setHTTPBody(NSData.dataWithStringEncoding(JSON.stringify(options.json), 4)) } else if (options.data) request.setHTTPBody(options.data)
    NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(request, NSOperationQueue.mainQueue(), (response: any, data: any, error: any) => {
      if (!isNativeNull(error)) return reject(new Error(nativeErrorMessage(error)))
      if (isNativeNull(response)) return reject(new Error("网络请求未返回 HTTP 响应"))
      const raw = typeof response.statusCode === "function" ? response.statusCode() : response.statusCode
      const numericStatus = isNativeNull(raw) ? 0 : Number(raw), status = Number.isFinite(numericStatus) ? numericStatus : 0
      const responseData = isNativeNull(data) ? undefined : data
      let json: any
      try { if (responseData) json = normalizeNativeJSON(NSJSONSerialization.JSONObjectWithDataOptions(responseData, NSJSONReadingOptions.FragmentsAllowed)) } catch {}
      if (status < 200 || status >= 300) return reject(new Error(responseError(json, status)))
      resolve({ status, json, data: responseData })
    })
  } catch (error) { reject(error) } })
}
function imageDataUris(html: string): string[] { return Array.from(String(html || "").matchAll(/src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)["']/g), match => match[1]) }
// 手写绘制以 canvas data-drawing 属性内联 base64；只有隐私开关明确允许时才进入上传集合。
function drawingDataUris(html: string): string[] { return Array.from(String(html || "").matchAll(/data-drawing=["']([A-Za-z0-9+/=\s]+)["']/g), match => match[1]) }

type BoundMindMapHandwritingAsset = { hash: string; base64: string; kind: "drawing" | "image"; mime?: string }

function rasterMime(base64: string): string | undefined {
  if (base64.startsWith("iVBOR")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  if (base64.startsWith("UklGR")) return "image/webp"
  return undefined
}

function sketchMediaHashes(note: any): string[] {
  const hashes: string[] = []
  const append = (value: any) => {
    const hash = String(value ?? "").trim()
    if (hash && !hashes.includes(hash)) hashes.push(hash)
  }
  append(note?.drawing)
  append(note?.excerptPic?.drawing)
  for (const comment of Array.from(note?.comments ?? []) as any[]) {
    append(comment?.drawing)
    append(comment?.q_hpic?.drawing)
  }
  for (const hash of String(note?.mediaList ?? "").split("-")) append(hash)
  append(note?.paint)
  append(note?.excerptPic?.paint)
  for (const comment of Array.from(note?.comments ?? []) as any[]) {
    append(comment?.paint)
    append(comment?.q_hpic?.paint)
  }
  return hashes
}

/**
 * 官方 JSBMbModelTool 暴露按焦点卡片读取脑图草稿的接口，但 marginnote npm
 * 的类型声明暂未包含该单数方法，因此在运行时做能力探测，并把不可用视为无附件。
 */
function readBoundMindMapHandwriting(notebookId: string, noteId: string): { status: "included" | "none" | "unsupported" | "unreadable"; assets: BoundMindMapHandwritingAsset[] } {
  try {
    const db: any = MN.db as any
    const readSketch = db?.getSketchNoteForMindMapFocusNoteId
    if (typeof readSketch !== "function") return { status: "unsupported", assets: [] }
    const sketch = readSketch.call(db, notebookId, noteId)
    if (isNativeNull(sketch)) return { status: "none", assets: [] }
    const assets: BoundMindMapHandwritingAsset[] = []
    for (const hash of sketchMediaHashes(sketch)) {
      try {
        const value = db.getMediaByHash(hash)?.base64Encoding?.()
        const base64 = String(value ?? "").replace(/\s/g, "")
        if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) continue
        const mime = rasterMime(base64)
        assets.push(mime ? { hash, base64, kind: "image", mime } : { hash, base64, kind: "drawing" })
      } catch {}
    }
    const drawings = assets.filter(asset => asset.kind === "drawing")
    const selected = drawings.length ? drawings : assets
    return selected.length ? { status: "included", assets: selected } : { status: "unreadable", assets: [] }
  } catch {
    return { status: "unreadable", assets: [] }
  }
}

function appendBoundMindMapHandwriting(questionHtml: string, result: ReturnType<typeof readBoundMindMapHandwriting>): string {
  if (!result.assets.length) return questionHtml
  const items = result.assets.map((asset, index) => asset.kind === "image"
    ? `<figure class="bound-mindmap-handwriting-item"><img src="data:${asset.mime};base64,${asset.base64}" alt="脑图绑定手写 ${index + 1}" /></figure>`
    : `<figure class="drawing bound-mindmap-handwriting-item"><canvas data-drawing-id="mindmap-${asset.hash}" data-drawing="${asset.base64}"></canvas></figure>`).join("")
  const section = `<style>.bound-mindmap-handwriting{margin-top:20px;padding-top:16px;border-top:1px solid #d9dde7}.bound-mindmap-handwriting>h2{margin:0 0 10px;font-size:14px;color:#6b7280}.bound-mindmap-handwriting-item{margin:8px 0}</style><section class="bound-mindmap-handwriting" aria-label="脑图绑定手写"><h2>脑图绑定手写</h2>${items}</section>`
  if (questionHtml.includes("</article>")) return questionHtml.replace("</article>", `${section}</article>`)
  return questionHtml.replace("</body>", `${section}</body>`)
}
/**
 * 使用插件已经过真机路径验证的 Latin-1 字符串桥创建二进制 NSData。
 * marginnote typings 中声明的 NSData 字节指针静态构造器在 MN4 真机并未暴露，
 * 而 JS Uint8Array 也不能作为 Objective-C 指针直接传入。
 */
function dataFromBase64Source(source: string): any {
  const base64 = String(source || "").split(",").pop()?.replace(/\s/g, "") || ""
  if (!base64) throw new Error("MinerU 上传图片为空")
  const data = NSData.dataWithStringEncoding(decodeBase64Ascii(base64), 5)
  if (isNativeNull(data)) throw new Error("当前 MarginNote 无法创建 MinerU 上传图片数据")
  return data
}
/**
 * 禁止通过 NSString 的 alloc 创建实例：MN4 的 JSC 会在 init 前尝试把 NSPlaceholderString
 * 自动桥接成 JS 字符串并触发不可捕获的 Objective-C 异常。NSData 返回已初始化
 * 的 base64 字符串，再在纯 JS 中解码 UTF-8，可安全读取 MinerU 的 full.md。
 */
function readUtf8(path: string): string {
  const data = NSData.dataWithContentsOfFile(path)
  if (isNativeNull(data)) return ""
  const encoded = data.base64Encoding?.()
  return isNativeNull(encoded) ? "" : decodeBase64Utf8(String(encoded))
}
/**
 * 带存在性预检的 JSON 文件读取。MarginNote 的 readJSON 直接把
 * NSData.dataWithContentsOfFile 的结果交给 NSJSONSerialization.JSONObjectWithData：
 * 文件缺失时 data 为 nil，官方语义是对 nil data 抛 NSInvalidArgumentException——
 * 该异常穿透 JavaScriptCore，JS try/catch 无法捕获，会直接 abort 应用（真机闪退根因）。
 * 因此读前必须用 isfileExists 预检（与 mistake-store/index-store 同一范式）。
 */
function readJSONFile(path: string): any {
  try {
    if (!isfileExists(path)) return undefined
    return readJSON(path)
  } catch {
    return undefined
  }
}
function cacheRoot() { return cardLinkDocumentPath("ai/ocr") }
function preparedContentRoot() { return cardLinkDocumentPath("ai/content") }
function preparedQuestionRoot() { return `${preparedContentRoot()}/records` }
function preparedQuestionImageRoot() { return `${preparedContentRoot()}/images` }
function preparedQuestionPath(recordId: string) { return `${preparedQuestionRoot()}/${sha256Hex(recordId)}.json` }
function preparedQuestionImagePath(recordId: string) { return `${preparedQuestionImageRoot()}/${sha256Hex(recordId)}.jpg` }
interface PreparedQuestionSnapshot {
  schemaVersion: 1 | 2
  recordId: string
  sourceNoteId: string
  sourceNotebookId: string
  sourceTitle: string
  contentFingerprint: string
  status: "ready"
  questionText: string
  ocrText: string
  provider: "mineru" | "bigmodel"
  model: "vlm" | "glm-ocr"
  processedAt: string
  imageFile?: string
  imageMime?: "image/jpeg"
  includedMindMapHandwriting?: boolean
  boundHandwritingCount?: number
}
function readPreparedQuestion(recordId: string): PreparedQuestionSnapshot | undefined {
  const value = readJSONFile(preparedQuestionPath(recordId))
  return value?.status === "ready" && value?.recordId === recordId && typeof value?.questionText === "string"
    ? value as PreparedQuestionSnapshot
    : undefined
}
function writePreparedQuestion(value: PreparedQuestionSnapshot): void {
  ensureDirectory(preparedQuestionRoot())
  writeTextFile(preparedQuestionPath(value.recordId), JSON.stringify(value))
}
function preparedQuestionSummaries(): any[] {
  ensureDirectory(preparedQuestionRoot())
  const manager: any = NSFileManager.defaultManager()
  const records = loadMistakeState().records
  const entries = Array.from(manager.contentsOfDirectoryAtPath(preparedQuestionRoot()) || []) as string[]
  return entries.filter(name => /\.json$/i.test(name)).map(name => readJSONFile(`${preparedQuestionRoot()}/${name}`))
    .filter(value => value?.status === "ready" && typeof value?.recordId === "string" && typeof value?.questionText === "string")
    .map(value => ({
      recordId: value.recordId,
      sourceTitle: text(value.sourceTitle, 200) || "未命名错题",
      sourceNotebookId: String(value.sourceNotebookId || ""),
      sourceNotebookTitle: text(records[value.recordId]?.sourceNotebookTitle, 120),
      provider: value.provider,
      model: value.model,
      processedAt: value.processedAt,
      hasImage: isfileExists(preparedQuestionImagePath(value.recordId)),
      includedMindMapHandwriting: value.includedMindMapHandwriting === true,
      boundHandwritingCount: Number(value.boundHandwritingCount) || 0
    })).sort((a, b) => String(b.processedAt || "").localeCompare(String(a.processedAt || "")))
}
function preparedQuestionDetail(recordId: string): any {
  const value = readPreparedQuestion(recordId)
  if (!value) return null
  let imageDataUri = ""
  try {
    const data = NSData.dataWithContentsOfFile(preparedQuestionImagePath(recordId))
    const encoded = isNativeNull(data) ? undefined : data.base64Encoding?.()
    if (!isNativeNull(encoded)) imageDataUri = `data:image/jpeg;base64,${String(encoded)}`
  } catch {}
  return { ...value, imageDataUri }
}
function setOCRProgress(job: any, progress: number, detail: string): void {
  job.status = "ocr"
  job.progress = Math.max(Number(job.progress) || 0, Math.min(44, Math.round(progress)))
  job.detail = detail
}
async function mineruOCR(dataUris: string[], job: any, progressStart = 10, progressEnd = 40, onProgress?: (progress: number, detail: string) => void): Promise<string> {
  const settings = loadAISettings(), token = secret(settings.mineru.credentialRef); if (!token) throw new Error("MinerU 尚未设置 Token")
  ensureDirectory(cacheRoot()); const chunks: string[][] = []; for (let i = 0; i < dataUris.length; i += 50) chunks.push(dataUris.slice(i, i + 50)); const markdown: string[] = []
  const update = (ratio: number, detail: string) => {
    const progress = progressStart + (progressEnd - progressStart) * Math.max(0, Math.min(1, ratio))
    if (onProgress) onProgress(progress, detail)
    else setOCRProgress(job, progress, detail)
  }
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]
    // 缓存键 = 完整内容的 SHA-256 指纹，杜绝采样弱哈希把别的图片缓存错配给本题。
    const uncached = chunk.filter(uri => { const path = `${cacheRoot()}/${sha256Hex(uri)}.json`; const hit = readJSONFile(path); if (hit?.markdown) { markdown.push(String(hit.markdown)); return false } return true })
    if (!uncached.length) { update((chunkIndex + 1) / chunks.length, "已读取 OCR 缓存"); continue }
    update(0.04, `正在申请 ${uncached.length} 张图片的上传地址`)
    const files = uncached.map((uri, index) => ({ name: `question-${index + 1}.${imageExtensionFromSource(uri)}`, data_id: `item-${Date.now().toString(36)}-${index + 1}` }))
    const uriByDataId = new Map(files.map((file, index) => [file.data_id, uncached[index]]))
    const created = await http("POST", `${settings.mineru.baseUrl}/api/v4/file-urls/batch`, { headers: { Authorization: `Bearer ${token}` }, json: { files, model_version: "vlm", language: settings.mineru.language, enable_formula: settings.mineru.enableFormula, enable_table: settings.mineru.enableTable }, timeoutMs: 60000 })
    const createError = mineruServiceError(created.json, "申请上传地址"); if (createError) throw new Error(createError)
    const batchId = created.json?.data?.batch_id, urls = created.json?.data?.file_urls || []; if (!batchId || urls.length !== uncached.length) throw new Error("MinerU 未返回完整上传地址")
    const uriByFileName = new Map(files.map((file, index) => [file.name, uncached[index]]))
    for (let index = 0; index < uncached.length; index++) {
      if (job.cancelled) throw new Error("任务已取消")
      update(.10 + (index / uncached.length) * .30, `正在上传图片 ${index + 1}/${uncached.length}`)
      // MinerU 的 OSS 预签名地址要求 Content-Type 为空；显式空值同时兼容会自动补头的客户端。
      await http("PUT", String(urls[index]), { headers: { "Content-Type": "" }, data: dataFromBase64Source(uncached[index]), timeoutMs: 120000 })
    }
    let results: Array<{ dataId: string; fileName: string; zipUrl: string }> = []
    let emptyPolls = 0
    for (let attempt = 0; attempt < 120 && results.length < uncached.length; attempt++) {
      if (job.cancelled) throw new Error("任务已取消"); if (attempt) await delay(3)
      const status = await http("GET", `${settings.mineru.baseUrl}/api/v4/extract-results/batch/${batchId}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 30000 })
      const statusError = mineruServiceError(status.json, "查询任务"); if (statusError) throw new Error(statusError)
      const items = mineruResultItems(status.json)
      emptyPolls = items.length ? 0 : emptyPolls + 1
      if (emptyPolls >= 5) throw new Error("MinerU 轮询响应连续缺少 data.extract_result，已停止轮询")
      const stateSummary = mineruStateSummary(status.json)
      update(.42 + (attempt / 119) * .43, `等待 MinerU 解析${stateSummary ? ` · ${stateSummary}` : ""}${attempt ? ` · 已轮询 ${attempt + 1} 次` : ""}`)
      results = mineruDoneResults(status.json)
      const failure = mineruFailureMessage(status.json); if (failure) throw new Error(`MinerU 解析失败：${failure}`)
      if (mineruMissingDoneArchive(status.json)) throw new Error("MinerU 已完成解析，但未返回结果下载地址")
    }
    if (results.length < uncached.length) throw new Error("MinerU 解析等待超时")
    for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
      const { dataId, fileName, zipUrl } = results[resultIndex]
      update(.88 + (resultIndex / results.length) * .10, `正在下载识别结果 ${resultIndex + 1}/${results.length}`)
      const source = (dataId ? uriByDataId.get(dataId) : undefined) || (fileName ? uriByFileName.get(fileName) : undefined) || (results.length === 1 && uncached.length === 1 ? uncached[0] : undefined); if (!source) throw new Error("MinerU 返回了未知 data_id/file_name，无法回对解析结果")
      const archive = await http("GET", zipUrl, { timeoutMs: 120000 }); if (!archive.data) continue
      const resultKey = (dataId || fileName || String(resultIndex + 1)).replace(/[^A-Za-z0-9._-]/g, "_")
      const temp = cardLinkTempPath(`ocr/mnam-ai-${batchId}-${resultKey}`), zip = `${temp}.zip`; ensureDirectory(temp); archive.data.writeToFileAtomically(zip, true); if (!ZipArchive.unzipFileAtPathToDestination(zip, temp)) throw new Error("MinerU 结果解压失败")
      const manager: any = NSFileManager.defaultManager(), md = (manager.subpathsOfDirectoryAtPath(temp) || []).find((name: string) => /(?:^|\/)full\.md$/i.test(name)); if (md) { const content = readUtf8(`${temp}/${md}`); if (content) { markdown.push(content); writeTextFile(`${cacheRoot()}/${sha256Hex(source)}.json`, JSON.stringify({ contentFingerprint: sha256Hex(source), createdAt: new Date().toISOString(), provider: "mineru", model: "vlm", markdown: content })) } } manager.removeItemAtPathError?.(zip, null); manager.removeItemAtPathError?.(temp, null)
    }
    update((chunkIndex + 1) / chunks.length, "图片识别完成")
  }
  return markdown.join("\n\n")
}

async function glmOCR(dataUris: string[], job: any, progressStart = 10, progressEnd = 40, onProgress?: (progress: number, detail: string) => void): Promise<string> {
  const settings = loadAISettings()
  const token = secret(settings.glmOcr.credentialRef)
  if (!token) throw new Error("GLM-OCR 尚未设置 API Key")
  ensureDirectory(cacheRoot())
  const markdown: string[] = []
  const update = (ratio: number, detail: string) => {
    const progress = progressStart + (progressEnd - progressStart) * Math.max(0, Math.min(1, ratio))
    if (onProgress) onProgress(progress, detail)
    else setOCRProgress(job, progress, detail)
  }
  for (let index = 0; index < dataUris.length; index++) {
    if (job.cancelled) throw new Error("任务已取消")
    const source = String(dataUris[index] || "")
    if (!/^data:image\/(?:jpeg|png);base64,/i.test(source)) throw new Error("GLM-OCR 仅支持 JPG、PNG 图片")
    const base64 = source.split(",").pop()?.replace(/\s/g, "") || ""
    const estimatedBytes = Math.floor(base64.length * 3 / 4)
    if (!base64) throw new Error("GLM-OCR 图片为空")
    if (estimatedBytes > 10 * 1024 * 1024) throw new Error("GLM-OCR 单张图片不能超过 10 MB")
    const cachePath = `${cacheRoot()}/glm-ocr-${sha256Hex(source)}.json`
    const hit = readJSONFile(cachePath)
    if (hit?.markdown) {
      markdown.push(String(hit.markdown))
      update((index + 1) / dataUris.length, "已读取 GLM-OCR 缓存")
      continue
    }
    update((index + .08) / dataUris.length, `正在发送图片至 GLM-OCR ${index + 1}/${dataUris.length}`)
    const result = await http("POST", `${settings.glmOcr.baseUrl}/layout_parsing`, {
      headers: { Authorization: `Bearer ${token}` },
      json: { model: "glm-ocr", file: base64, return_crop_images: false, need_layout_visualization: false },
      timeoutMs: settings.glmOcr.timeoutMs
    })
    if (job.cancelled) throw new Error("任务已取消")
    update((index + .9) / dataUris.length, "正在读取 GLM-OCR 识别结果")
    const content = String(result.json?.md_results || "").trim()
    if (!content) throw new Error("GLM-OCR 返回成功，但没有识别文本")
    markdown.push(content)
    writeTextFile(cachePath, JSON.stringify({ contentFingerprint: sha256Hex(source), createdAt: new Date().toISOString(), provider: "bigmodel", model: "glm-ocr", markdown: content, usage: result.json?.usage }))
    update((index + 1) / dataUris.length, "GLM-OCR 识别完成")
  }
  return markdown.join("\n\n")
}

async function selectedOCR(dataUris: string[], job: any, engine: OCREngine, progressStart = 10, progressEnd = 40, onProgress?: (progress: number, detail: string) => void): Promise<string> {
  return engine === "glm-ocr"
    ? glmOCR(dataUris, job, progressStart, progressEnd, onProgress)
    : mineruOCR(dataUris, job, progressStart, progressEnd, onProgress)
}
async function callLLM(profile: AIProfile, prompt: string) {
  const key = secret(profile.credentialRef); if (!key) throw new Error(`${profile.name} 尚未设置 API Key`)
  const system = `你是严谨的错题分析助手。只依据证据，以简洁中文生成错题报告。${REPORT_FORMAT_INSTRUCTION}`
  const chatCompletions = profile.type === "deepseek"
  const body = chatCompletions
    ? { model: profile.model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], response_format: { type: "json_object" } }
    : { model: profile.model, input: [{ role: "system", content: [{ type: "input_text", text: system }] }, { role: "user", content: [{ type: "input_text", text: prompt }] }], text: { format: { type: "json_schema", name: "mistake_report", schema: REPORT_SCHEMA, strict: true } } }
  const endpoint = chatCompletions ? "chat/completions" : "responses"
  const result = await http("POST", `${profile.baseUrl}/${endpoint}`, { headers: { Authorization: `Bearer ${key}` }, json: body, timeoutMs: profile.timeoutMs })
  const resultText = extractAIOutputText(result.json)
  if (!resultText.trim()) throw new Error(`${profile.name} 返回成功，但响应中没有文本内容`)
  return { text: resultText, usage: result.json?.usage, endpoint }
}

/** 模型请求期间持续推进可见进度，避免网络等待被误判为卡死。 */
async function awaitAnalysisResult<T>(request: Promise<T>, job: any): Promise<T> {
  const outcome = request.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
  while (true) {
    const event = await Promise.race([outcome, delay(1).then(() => null)])
    if (event) {
      if (event.ok) return event.value
      throw event.error
    }
    job.progress = Math.min(82, Math.max(48, Number(job.progress) || 48) + 2)
  }
}

function reportRoot() { return cardLinkDocumentPath("ai/reports") }
function ensureDirectory(path: string) { const manager: any = NSFileManager.defaultManager(); if (!manager.fileExistsAtPath(path)) manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(path, true, null) }
function reports(): any[] { const value = readJSONFile(`${reportRoot()}/index.json`); return Array.isArray(value) ? value : [] }
function writeReports(value: any[]) { ensureDirectory(reportRoot()); writeTextFile(`${reportRoot()}/index.json`, JSON.stringify(value)) }
function fingerprint(records: any[]) { let hash = 2166136261; for (const char of records.map(item => `${item.recordId}:${item.updatedAt}`).sort().join("|")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16) }
/** 证据校验（方案 §22）：AI 引用的 Q 编号必须能兑现匿名映射，幻觉引用一律剔除。 */
function validateEvidence(report: ReturnType<typeof parseAIReport>, evidence: Record<string, string>): number {
  let dropped = 0
  const clean = (refs: unknown) => strings(refs).filter(ref => { if (evidence[ref]) return true; dropped++; return false })
  for (const item of report.weakPoints) item.evidence = clean(item.evidence)
  for (const item of report.errorPatterns) item.evidence = clean(item.evidence)
  for (const item of report.reviewAdvice) item.evidence = clean(item.evidence)
  return dropped
}

const jobs: Record<string, any> = {}
const TERMINAL_JOB_STATUSES = ["done", "failed", "cancelled"]
const preparationJobs: Record<string, any> = {}
const PREPARATION_TERMINAL_STAGES = ["success", "failed"]

function publicPreparationJob(job: any): any {
  if (!job) return { status: "missing" }
  const current = job.current ? { ...job.current } : undefined
  const partial = current && !PREPARATION_TERMINAL_STAGES.includes(current.stage)
    ? Math.max(0, Math.min(1, Number(current.progress || 0) / 100))
    : 0
  const totalProgress = job.total ? Math.round(Math.min(1, (job.completed + partial) / job.total) * 100) : 100
  return {
    id: job.id,
    studySetId: job.studySetId,
    studySetTitle: job.studySetTitle,
    ocrEngine: job.ocrEngine,
    status: job.status,
    total: job.total,
    completed: job.completed,
    success: job.success,
    failed: job.failed,
    totalProgress,
    createdAt: job.createdAt,
    current
  }
}

function prepareCurrentQuestion(job: any): void {
  const recordId = job.recordIds[job.position]
  if (!recordId) {
    job.current = undefined
    job.status = "done"
    return
  }
  const record = loadMistakeState().records[recordId]
  job.current = {
    recordId,
    title: text(record?.sourceTitle, 160) || `错题 ${job.position + 1}`,
    index: job.position + 1,
    total: job.total,
    stage: "waiting-render",
    progress: 0,
    detail: "等待渲染题目卡片",
    ocrText: ""
  }
  job.status = "waiting-render"
}

function finishPreparationItem(job: any, stage: "success" | "failed", detail: string, ocrText = "", error = ""): void {
  if (!job.current || PREPARATION_TERMINAL_STAGES.includes(job.current.stage)) return
  job.current.stage = stage
  job.current.progress = stage === "success" ? 100 : Number(job.current.progress || 0)
  job.current.detail = detail
  job.current.ocrText = ocrText
  job.current.error = error
  job.completed += 1
  job[stage] += 1
  job.status = job.completed >= job.total ? "done" : "waiting-advance"
}

async function processPreparationImage(job: any, recordId: string, imageDataUri: string): Promise<void> {
  try {
    if (job.cancelled) { job.status = "cancelled"; return }
    const record = loadMistakeState().records[recordId]
    if (!record) throw new Error("错题记录不存在")
    job.status = "running"
    job.current.stage = "uploading"
    job.current.progress = 1
    job.current.detail = "正在上传整张题目卡片"
    const engine: OCREngine = job.ocrEngine
    const ocrText = (await selectedOCR([imageDataUri], job, engine, 0, 100, (progress, detail) => {
      if (job.cancelled || job.current?.recordId !== recordId) return
      job.current.progress = Math.max(Number(job.current.progress) || 0, Math.round(progress))
      job.current.stage = /上传|申请|发送/.test(detail) ? "uploading" : "ocr"
      job.current.detail = detail
    })).trim()
    if (job.cancelled) { job.status = "cancelled"; return }
    if (!ocrText) throw new Error("OCR 返回内容为空")
    ensureDirectory(preparedQuestionImageRoot())
    const imagePath = preparedQuestionImagePath(recordId)
    const imageData = dataFromBase64Source(imageDataUri)
    if (!imageData.writeToFileAtomically(imagePath, true)) throw new Error("OCR 已完成，但原题卡片图片保存失败")
    writePreparedQuestion({
      schemaVersion: 2,
      recordId,
      sourceNoteId: String(record.sourceNoteId || ""),
      sourceNotebookId: String(record.sourceNotebookId || ""),
      sourceTitle: text(record.sourceTitle, 200),
      contentFingerprint: sha256Hex(imageDataUri),
      status: "ready",
      questionText: ocrText,
      ocrText,
      provider: engine === "glm-ocr" ? "bigmodel" : "mineru",
      model: engine === "glm-ocr" ? "glm-ocr" : "vlm",
      processedAt: new Date().toISOString(),
      imageFile: `images/${sha256Hex(recordId)}.jpg`,
      imageMime: "image/jpeg",
      includedMindMapHandwriting: job.includeMindMapHandwriting === true && Number(job.current?.boundHandwritingCount || 0) > 0,
      boundHandwritingCount: Number(job.current?.boundHandwritingCount) || 0
    })
    finishPreparationItem(job, "success", "识别并保存完成", ocrText)
  } catch (reason) {
    if (job.cancelled) { job.status = "cancelled"; return }
    const message = text((reason as any)?.message || reason, 300) || "OCR 失败"
    finishPreparationItem(job, "failed", message, "", message)
  }
}

function hasActiveJob(subjectId: string): boolean {
  return Object.values(jobs).some(job => job.subjectId === subjectId && !TERMINAL_JOB_STATUSES.includes(job.status))
}
function pruneFinishedJobs(keep = 10): void {
  const finished = Object.entries(jobs)
    .filter(([, job]) => TERMINAL_JOB_STATUSES.includes(job.status))
    .sort((a, b) => String(b[1].createdAt || "").localeCompare(String(a[1].createdAt || "")))
  for (const [id] of finished.slice(keep)) delete jobs[id]
}
async function runAnalysis(job: any, subject: AISubject, profile: AIProfile) { try {
  const settings = loadAISettings()
  const all = Object.values(loadMistakeState().records)
    .filter(record => subject.studySetIds.includes(record.sourceNotebookId))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
  if (!all.length) throw new Error("该科目没有可分析的错题")
  // 截断必须确定（按最近更新取前 MAX_RECORDS 条）且在报告中可感知。
  const records = all.slice(0, MAX_RECORDS)
  job.status = "preparing"; job.progress = 8
  const contentReader = createMistakeContentReader()
  const evidence: Record<string, string> = {}, items: string[] = [], failureReasons = new Map<string, number>(); let unavailable = 0, missingAnswers = 0
  for (let index = 0; index < records.length; index++) {
    if (job.cancelled) { job.status = "cancelled"; return }
    // 逐题让出主线程：每道题之间都给桥接留出响应窗口，批量读取不得长期独占 JS 线程。
    await delay(0.03)
    const record = records[index], ref = `Q${String(index + 1).padStart(3, "0")}`; evidence[ref] = record.recordId
    try {
      // AI 总结只消费题目准备阶段落盘的 OCR 文本；不再临时上传题图，也不把大文本写进 mistakes.v2。
      const prepared = readPreparedQuestion(record.recordId)
      if (!prepared) throw new Error("题目尚未准备")
      const question = prepared.questionText.slice(0, 7600)
      const clean = (html: string, limit: number) => cardHtmlToMarkdown(html).replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]").slice(0, limit)
      let answer = ""
      if (settings.privacy.includeAnswer) {
        try {
          const content = contentReader.read(record.recordId)
          answer = content.answers[0] ? clean(content.answers[0].html, 1600) : ""
          if (!content.answers.length) missingAnswers++
        } catch { missingAnswers++ }
      }
      items.push(`${ref}\n题目：${question}\n${answer ? `答案：${answer}\n` : ""}${settings.privacy.includeSourcePath ? `路径：${record.sourceNotebookTitle} > ${record.sourcePathTitles.join(" > ")}\n` : ""}状态：${["不会", "不熟", "掌握"][record.level]}；复习${record.reviewCount}次${settings.privacy.includeCustomCategories ? `；标签：${(record.manualCategories || []).join("、")}` : ""}${settings.privacy.includeReviewHistory ? `；历史：${record.history.map(item => item.level).join("→")}` : ""}`)
    } catch (error) {
      unavailable++
      // 失败原因按消息聚合：批量提取的系统性失败必须可见、可诊断，不得静默吞掉。
      const reason = text((error as any)?.message || error, 80)
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1)
    }
    job.progress = Math.max(Number(job.progress) || 0, 10 + Math.round((index + 1) / records.length * 30))
    job.detail = `已读取 ${index + 1}/${records.length} 道错题`
  }
  const reasonSummary = [...failureReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => `${reason} ×${count}`).join("；")
  if (!items.length) throw new Error(`错题内容均无法读取${reasonSummary ? `（${reasonSummary}）` : ""}`)
  job.status = "analyzing"; job.progress = 48; job.detail = "正在生成错题总结"
  const counts = [0, 1, 2].map(level => records.filter(record => record.level === level).length)
  const result = await awaitAnalysisResult(callLLM(profile, `科目：${subject.name}\n共${records.length}题；不会${counts[0]}，不熟${counts[1]}，掌握${counts[2]}；内容不可用${unavailable}，缺答案${missingAnswers}。提炼薄弱点、错误模式和可执行建议。每项必须引用 Q 编号，不得编造；说明不超过80字。\n\n${items.join("\n\n").slice(0, 120000)}`), job)
  job.status = "saving"; job.progress = 88; job.detail = "正在保存报告"
  const report = parseAIReport(result.text)
  const droppedEvidence = validateEvidence(report, evidence)
  const limitations = [...report.limitations]
  if (records.length < all.length) limitations.push(`错题共 ${all.length} 道，本次仅分析最近更新的 ${records.length} 道（上限 ${MAX_RECORDS}）`)
  if (droppedEvidence) limitations.push(`AI 引用了 ${droppedEvidence} 个不存在的题目编号，已剔除`)
  if (unavailable && reasonSummary) limitations.push(`内容不可用 ${unavailable} 道（${reasonSummary}）`)
  const saved = { id: `report-${Date.now().toString(36)}`, subjectId: subject.id, subjectName: subject.name, createdAt: new Date().toISOString(), scopeFingerprint: fingerprint(records), recordCount: records.length, coverage: { usable: items.length, unavailable, missingAnswers, total: all.length, analyzed: records.length }, provider: profile.type, model: profile.model, promptVersion: "mistake-summary.v1", evidence, usage: result.usage, content: { ...report, limitations } }
  const allReports = reports(); allReports.unshift(saved); writeReports(allReports); job.status = "done"; job.progress = 100; job.detail = "报告已生成"; job.reportId = saved.id
} catch (error) { job.status = "failed"; job.error = text((error as any)?.message || error, 300) } }

export function isAICommand(command: string) { return command.startsWith("ai") }
let scheduleRunning = false
export async function runDueAIAnalyses(): Promise<void> {
  if (scheduleRunning) return; const settings = loadAISettings(); if (!settings.enabled) return; scheduleRunning = true
  try { pruneFinishedJobs(); for (const subject of settings.subjects.filter(item => item.schedule.enabled)) {
    if (hasActiveJob(subject.id)) continue
    const profile = settings.profiles.find(item => item.id === settings.defaultProfileId); if (!profile || !secret(profile.credentialRef)) continue; const interval = subject.schedule.frequency === "daily" ? 86400000 : subject.schedule.frequency === "weekly" ? 7 * 86400000 : 28 * 86400000; if (subject.schedule.lastRunAt && Date.now() - new Date(subject.schedule.lastRunAt).getTime() < interval) continue; const job = { id: `job-auto-${Date.now().toString(36)}`, subjectId: subject.id, status: "created", progress: 0, createdAt: new Date().toISOString(), cancelled: false }; jobs[job.id] = job; await runAnalysis(job, subject, profile); if (job.status === "done") { subject.schedule.lastRunAt = new Date().toISOString(); saveAISettings(settings) } } } finally { scheduleRunning = false }
}
export async function aiBridge(command: string, payload: any): Promise<any> {
  // 配置命令始终可用：总开关本身就在配置页里操作。
  if (command === "aiConfirmDevelopmentWarning") return confirmAIDevelopmentWarning()
  if (command === "aiGetSettings") return publicSettings()
  if (command === "aiSaveSettings") { saveAISettings(payload); return publicSettings() }
  if (command === "aiListStudySets") return (MN.db.allNotebooks() || []).filter((item: any) => item?.topicId && isMindMapNotebook(item)).map((item: any) => ({ id: String(item.topicId), title: text(item?.title, 100) || "未命名学习集" }))
  if (command === "aiListMistakeStudySets") {
    const counts = new Map<string, number>()
    for (const record of Object.values(loadMistakeState().records)) counts.set(record.sourceNotebookId, (counts.get(record.sourceNotebookId) || 0) + 1)
    return (MN.db.allNotebooks() || [])
      .filter((item: any) => item?.topicId && isMindMapNotebook(item) && (counts.get(String(item.topicId)) || 0) > 0)
      .map((item: any) => ({ id: String(item.topicId), title: text(item?.title, 100) || "未命名学习集", mistakeCount: counts.get(String(item.topicId)) || 0 }))
  }
  if (command === "aiSetCredential") { const ref = text(payload?.credentialRef, 100); if (!ref) throw new Error("凭据引用无效"); const result = await popup({ title: "设置 API 凭据", message: payload?.persistence === "local" ? "将保存在插件本地存储，不具备系统 Keychain 加密" : "仅本次运行保存，不会返回网页界面", type: UIAlertViewStyle.SecureTextInput, buttons: ["保存"], canCancel: true }); const value = String(result.inputContent || "").trim(); if (result.buttonIndex < 0 || !value) return secretStatus(ref); if (payload?.persistence === "local") { const stored = persistentCredentials(); stored[ref] = value; setLocalDataByKey(stored, CREDENTIALS_KEY); delete sessionCredentials[ref] } else sessionCredentials[ref] = value; return secretStatus(ref) }
  if (command === "aiClearCredential") { const ref = text(payload?.credentialRef, 100), stored = persistentCredentials(); delete stored[ref]; delete sessionCredentials[ref]; setLocalDataByKey(stored, CREDENTIALS_KEY); return secretStatus(ref) }
  if (command === "aiTestProvider") { const profile = loadAISettings().profiles.find(item => item.id === payload?.profileId); if (!profile) throw new Error("AI 服务不存在"); const result = await callLLM(profile, "生成测试报告：summary 为连接成功，其余数组为空。"); parseAIReport(result.text); return { connected: true, provider: profile.type, model: profile.model, endpoint: result.endpoint } }
  if (command === "aiTestMinerU") { const settings = loadAISettings(), token = secret(settings.mineru.credentialRef); if (!token) throw new Error("MinerU 尚未设置 Token"); await http("GET", `${settings.mineru.baseUrl}/api/v4/extract-results/batch/connection-test`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15000 }).catch(error => { if (!/不存在|not found|HTTP 404/i.test(String((error as any)?.message || error))) throw error }); return { connected: true } }
  // 运行时命令的统一闸门：总开关未打开时，AI 分析、任务与报告子系统一律不运行。
  if (!loadAISettings().enabled) throw new Error("AI 错题分析未开启，请先在设置中开启")
  if (command === "aiRunDueSchedules") { void runDueAIAnalyses(); return { accepted: true } }
  if (command === "aiStartQuestionPreparation") {
    const settings = loadAISettings()
    if (!settings.mineru.enabled) throw new Error("请先启用题目识别")
    const ocrCredentialRef = settings.ocrEngine === "glm-ocr" ? settings.glmOcr.credentialRef : settings.mineru.credentialRef
    if (!secret(ocrCredentialRef)) throw new Error(settings.ocrEngine === "glm-ocr" ? "GLM-OCR 尚未设置 API Key" : "MinerU 尚未设置 Token")
    const studySetId = text(payload?.studySetId, 100)
    const studySet = (MN.db.allNotebooks() || []).find((item: any) => String(item?.topicId || "") === studySetId)
    if (!studySet) throw new Error("学习集不存在")
    const active = Object.values(preparationJobs).find((item: any) => !["done", "cancelled"].includes(item.status))
    if (active) throw new Error("已有题目准备任务正在进行，请等待完成或先取消")
    const finished = Object.keys(preparationJobs).filter(id => ["done", "cancelled"].includes(preparationJobs[id].status))
    for (const id of finished.slice(0, Math.max(0, finished.length - 5))) delete preparationJobs[id]
    const records = Object.values(loadMistakeState().records)
      .filter(record => record.sourceNotebookId === studySetId)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    if (!records.length) throw new Error("所选学习集没有错题，无需 OCR")
    const job: any = {
      id: `ocr-prep-${Date.now().toString(36)}`,
      studySetId,
      studySetTitle: text(studySet?.title, 100) || "未命名学习集",
      ocrEngine: settings.ocrEngine,
      includeMindMapHandwriting: settings.privacy.mindMapHandwriting,
      status: "waiting-render",
      total: records.length,
      completed: 0,
      success: 0,
      failed: 0,
      position: 0,
      recordIds: records.map(record => record.recordId),
      reader: createMistakeContentReader(),
      createdAt: new Date().toISOString(),
      cancelled: false
    }
    preparationJobs[job.id] = job
    prepareCurrentQuestion(job)
    return publicPreparationJob(job)
  }
  if (command === "aiGetQuestionPreparationJob") return publicPreparationJob(preparationJobs[String(payload?.jobId)])
  if (command === "aiGetPreparationQuestion") {
    const job = preparationJobs[String(payload?.jobId)]
    if (!job || !job.current) throw new Error("题目准备任务不存在")
    if (job.cancelled || job.status === "cancelled") throw new Error("题目准备任务已取消")
    if (job.current.recordId !== String(payload?.recordId || job.current.recordId)) throw new Error("当前题目已变化，请刷新任务状态")
    try {
      const value = job.reader.readQuestion(job.current.recordId)
      const record = loadMistakeState().records[job.current.recordId]
      const handwriting = job.includeMindMapHandwriting && record
        ? readBoundMindMapHandwriting(String(record.sourceNotebookId || ""), String(record.sourceNoteId || ""))
        : { status: "none" as const, assets: [] }
      const questionHtml = job.includeMindMapHandwriting ? appendBoundMindMapHandwriting(value.questionHtml, handwriting) : value.questionHtml
      job.current.stage = "rendering"
      job.current.boundHandwritingStatus = job.includeMindMapHandwriting ? handwriting.status : "disabled"
      job.current.boundHandwritingCount = handwriting.assets.length
      job.current.detail = handwriting.status === "included" ? `正在渲染整张题目卡片（含 ${handwriting.assets.length} 项脑图绑定手写）` : "正在渲染整张题目卡片"
      return { recordId: job.current.recordId, title: job.current.title, questionHtml, boundHandwritingStatus: job.current.boundHandwritingStatus, boundHandwritingCount: handwriting.assets.length }
    } catch (reason) {
      const message = text((reason as any)?.message || reason, 300) || "读取题目失败"
      finishPreparationItem(job, "failed", message, "", message)
      throw new Error(message)
    }
  }
  if (command === "aiSubmitPreparationImage") {
    const job = preparationJobs[String(payload?.jobId)]
    const recordId = String(payload?.recordId || "")
    const imageDataUri = String(payload?.imageDataUri || "")
    if (!job || !job.current) throw new Error("题目准备任务不存在")
    if (job.cancelled || job.status === "cancelled") throw new Error("题目准备任务已取消")
    if (job.current.recordId !== recordId) throw new Error("当前题目已变化，请重新渲染")
    if (!["rendering", "waiting-render"].includes(job.current.stage)) return { accepted: false, duplicate: true }
    if (!/^data:image\/(?:jpeg|png);base64,/i.test(imageDataUri)) throw new Error("题目卡片图片格式无效")
    job.current.stage = "queued"
    job.current.detail = "题目卡片已提交，等待 OCR"
    void processPreparationImage(job, recordId, imageDataUri)
    return { accepted: true }
  }
  if (command === "aiFailPreparationQuestion") {
    const job = preparationJobs[String(payload?.jobId)]
    if (!job || !job.current) throw new Error("题目准备任务不存在")
    if (job.current.recordId !== String(payload?.recordId || "")) throw new Error("当前题目已变化")
    const message = text(payload?.error, 300) || "题目卡片渲染失败"
    finishPreparationItem(job, "failed", message, "", message)
    return publicPreparationJob(job)
  }
  if (command === "aiAdvanceQuestionPreparation") {
    const job = preparationJobs[String(payload?.jobId)]
    if (!job) throw new Error("题目准备任务不存在")
    if (job.status === "done" || job.status === "cancelled") return publicPreparationJob(job)
    if (!job.current || !PREPARATION_TERMINAL_STAGES.includes(job.current.stage)) throw new Error("当前题目尚未完成")
    job.position += 1
    prepareCurrentQuestion(job)
    return publicPreparationJob(job)
  }
  if (command === "aiCancelQuestionPreparation") {
    const job = preparationJobs[String(payload?.jobId)]
    if (job) { job.cancelled = true; job.status = "cancelled" }
    return { cancelled: !!job }
  }
  if (command === "aiStartAnalysis") { const settings = loadAISettings(); const subject = settings.subjects.find(item => item.id === payload?.subjectId), profile = settings.profiles.find(item => item.id === settings.defaultProfileId); if (!subject) throw new Error("科目不存在"); if (!profile) throw new Error("默认 AI 服务未配置"); if (hasActiveJob(subject.id)) throw new Error("该科目已有分析任务正在进行，请等待完成或先取消"); const job = { id: `job-${Date.now().toString(36)}`, subjectId: subject.id, status: "created", progress: 0, createdAt: new Date().toISOString(), cancelled: false }; jobs[job.id] = job; void runAnalysis(job, subject, profile); return { ...job } }
  if (command === "aiGetJob") return jobs[String(payload?.jobId)] || { status: "missing" }
  if (command === "aiCancelJob") { const job = jobs[String(payload?.jobId)]; if (job) job.cancelled = true; return { cancelled: !!job } }
  if (command === "aiPreviewAnalysis") { const subject = loadAISettings().subjects.find(item => item.id === payload?.subjectId); if (!subject) throw new Error("科目不存在"); const records = Object.values(loadMistakeState().records).filter(record => subject.studySetIds.includes(record.sourceNotebookId)); return { subjectId: subject.id, recordCount: records.length, analyzableCount: Math.min(records.length, MAX_RECORDS), preparedCount: records.filter(item => !!readPreparedQuestion(item.recordId)).length, withHistory: records.filter(item => item.history.length > 1).length, withoutAnswerBinding: records.filter(item => !item.answerNotebookId).length } }
  if (command === "aiListReports") {
    const settings = loadAISettings()
    const fingerprintBySubject = new Map<string, string>()
    const currentFingerprint = (subject: AISubject | undefined) => {
      const studySetIds = subject?.studySetIds ?? []
      const key = subject?.id ?? ""
      const cachedValue = fingerprintBySubject.get(key)
      if (cachedValue !== undefined) return cachedValue
      const value = fingerprint(Object.values(loadMistakeState().records).filter(record => studySetIds.includes(record.sourceNotebookId)))
      fingerprintBySubject.set(key, value)
      return value
    }
    return reports().map(report => { const subject = settings.subjects.find(item => item.id === report.subjectId); return { ...report, content: undefined, evidence: undefined, stale: currentFingerprint(subject) !== report.scopeFingerprint } })
  }
  if (command === "aiGetCacheStats") { const manager: any = NSFileManager.defaultManager(); let ocrEntries = 0, preparedEntries = 0; try { ocrEntries = (manager.contentsOfDirectoryAtPath(cacheRoot()) || []).length } catch {} try { preparedEntries = (manager.contentsOfDirectoryAtPath(preparedQuestionRoot()) || []).length } catch {} return { ocrEntries, preparedEntries, reportCount: reports().length } }
  if (command === "aiListPreparedQuestions") return preparedQuestionSummaries()
  if (command === "aiGetPreparedQuestion") return preparedQuestionDetail(text(payload?.recordId, 300))
  if (command === "aiClearOCRCache") { const manager: any = NSFileManager.defaultManager(); try { manager.removeItemAtPathError(cacheRoot(), null) } catch {} try { manager.removeItemAtPathError(preparedContentRoot(), null) } catch {} ensureDirectory(cacheRoot()); ensureDirectory(preparedQuestionRoot()); ensureDirectory(preparedQuestionImageRoot()); return { cleared: true } }
  if (command === "aiGetReport") return reports().find(report => report.id === payload?.reportId) || null
  if (command === "aiOpenEvidence") { const report = reports().find(item => item.id === payload?.reportId), recordId = report?.evidence?.[String(payload?.reference || "")]; if (!recordId) throw new Error("证据题不存在"); return openSourceByMistakeId(recordId) }
  if (command === "aiDeleteReport") { writeReports(reports().filter(report => report.id !== payload?.reportId)); return { deleted: true } }
  throw new Error(`未知 AI 命令：${command}`)
}
