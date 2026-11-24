import { startReviewMode } from "../review-mode"
/**
 * P4-1：Harness 运行时（经典 JSB 侧）。懒加载单例：
 * SQLiteDatabase 桥（CardLink/harness/h1.sqlite）→ JsbSqliteDriver → 迁移 →
 * createHarnessApp → 15 条白名单命令桥（§13）。
 * 关键边界（GPT 风险警告）：快照构建在 JSB 侧直读 CardLink 数据完成导入，
 * WebView 只收到导入摘要（计数/快照 ID/时间），不接收记录数据。
 */
import { ensureStorageDirectory, cardLinkDocumentPath } from "../storage-paths"
import { loadMistakeState } from "../mistake-store"
import { createAnswerTextProjector, harnessMatchedAnswers, harnessQuestionExcerpt, previewQuestionHtml } from "../mistake-manager"
import { ocrStore } from "../ocr-native"
import { openNoteInMindMap } from "../note-navigation"
import { delay, MN, isNSNull } from "marginnote"
import { loadBindings } from "../store"
import { normalizeBinding } from "../binding"
import type { MistakeRecord } from "../mistake-domain"
import { sourceFingerprint, type SourceFingerprint } from "./source-fingerprint"
import { JsbSqliteDriver } from "../../cardlink-harness/src/adapters/jsb/jsb-sqlite.ts"
import { migrate } from "../../cardlink-harness/src/adapters/sqlite/db.ts"
import { createHarnessApp, type HarnessApp } from "../../cardlink-harness/src/bootstrap.ts"
import { createBridgeHandler, type BridgeResult } from "../../cardlink-harness/src/adapters/bridge/commands.ts"
import { judgeFreshness } from "../../cardlink-harness/src/application/data-freshness.ts"
import { SqliteCredentialStore, SqliteProviderConfigStore } from "../../cardlink-harness/src/adapters/sqlite/sqlite-provider-store.ts"
import { SqliteRoleConfigStore } from "../../cardlink-harness/src/adapters/sqlite/sqlite-provider-store.ts"
import { ProviderRouterModelClient } from "../../cardlink-harness/src/adapters/model/provider-router.ts"
import { loadConfig } from "../../cardlink-harness/src/config.ts"
import { buildSnapshotPayload } from "../../cardlink-harness/src/harness/snapshot-builder.ts"
import { installAbortControllerPolyfill } from "../../cardlink-harness/src/platform/abort.ts"

// JSB JavaScriptCore 无 AbortController——先于任何 harness 代码安装 polyfill（b12）。
installAbortControllerPolyfill()
import { createDeviceModelCatalog, createDeviceProtocolClient } from "./model-transport"
import { deviceToolTimer } from "./timers"

/** 设备默认 Provider ID（§12.2 修订 2026-11-14：配置/角色/密钥持久化于 Harness SQLite）。 */
export const DEFAULT_PROVIDER_ID = "cardlink-device"

/**
 * 预置 DeepSeek 配置（§12.2 修订）：首次运行（Provider 表为空）时写入
 * 默认服务商与助手/审核角色，用户只需填一次 API Key（持久保存）。
 */
function ensureDefaultProvider(
  providerStore: SqliteProviderConfigStoreLike,
  roleStore: SqliteRoleConfigStoreLike,
): void {
  // v2.5 §5.2：旧版助手输出上限是硬编码 2,048（UI 从未暴露该值）——升级为 16,384；
  // 用户自定义的其他值不动，实际生效仍受模型能力上限约束。
  const existingAssistant = roleStore.get("assistant")
  if (existingAssistant && existingAssistant.maxOutputTokens === 2048) {
    roleStore.set("assistant", { ...existingAssistant, maxOutputTokens: 16384 })
  }
  if (providerStore.get(DEFAULT_PROVIDER_ID)) return
  providerStore.upsert({
    id: DEFAULT_PROVIDER_ID,
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    credentialRef: "device-key",
    enabled: true,
  })
  if (!roleStore.get("assistant")) {
    roleStore.set("assistant", { providerId: DEFAULT_PROVIDER_ID, model: "deepseek-chat", credentialRef: "device-key", timeoutMs: 60000, maxOutputTokens: 16384 })
  }
  if (!roleStore.get("reviewer")) {
    roleStore.set("reviewer", { providerId: DEFAULT_PROVIDER_ID, model: "deepseek-chat", credentialRef: "device-key", timeoutMs: 60000, maxOutputTokens: 1024 })
  }
}

/**
 * 原生 SQLiteDatabase 桥（与 ocr-native.openNativeSQL 同一检测策略，但不经其包装——
 * JsbSqliteDriver 需要原始桥面以复用语句拆分与数值归一化）。仅打开本 Harness 专用库。
 */
function openRawSqliteBridge(path: string): NonNullable<unknown> {
  const cls = (globalThis as { SQLiteDatabase?: { databaseWithPath?: unknown } }).SQLiteDatabase
  if (typeof cls?.databaseWithPath !== "function") throw new Error("当前宿主未提供 SQLiteDatabase，Harness 存储暂不可用")
  const db = (cls.databaseWithPath as (p: string) => unknown)(path)
  if (!db || isNSNull(db) || typeof (db as Record<string, unknown>).executeUpdateWithArgumentsInArray !== "function" || typeof (db as Record<string, unknown>).executeQueryWithArgumentsInArray !== "function") {
    throw new Error("当前 SQLite 桥接缺少数组参数绑定方法，Harness 存储已停止初始化")
  }
  const bridge = db as { open(): unknown }
  if (bridge.open() === false) throw new Error("Harness 数据库无法打开，请检查存储空间与权限")
  return db
}

type SqliteProviderConfigStoreLike = import("../../cardlink-harness/src/application/ports/provider-store.ts").ProviderConfigStore
type SqliteRoleConfigStoreLike = import("../../cardlink-harness/src/application/ports/role-config-store.ts").RoleConfigStore
type SqliteCredentialStoreLike = import("../../cardlink-harness/src/application/ports/provider-store.ts").ModelCredentialStore

let runtime: { app: HarnessApp; handle: (command: string, data?: unknown) => Promise<BridgeResult> } | null = null

/** 懒加载 Harness 运行时；SQLite 打不开等故障显式抛错（不静默降级）。 */
function harnessRuntime() {
  if (!runtime) {
    const dir = cardLinkDocumentPath("harness")
    ensureStorageDirectory(dir)
    const driver = new JsbSqliteDriver(openRawSqliteBridge(`${dir}/h1.sqlite`) as never)
    migrate(driver)
    // §12.2 修订：Provider/角色/密钥持久化于 Harness SQLite（重启保留；密钥混淆存储）。
    const providers = new SqliteProviderConfigStore(driver)
    const credentials = new SqliteCredentialStore(driver)
    const roles = new SqliteRoleConfigStore(driver)
    ensureDefaultProvider(providers, roles)
    const app = createHarnessApp(loadConfig({
      // 设备默认路由（§5.1.2）：预置 DeepSeek（§12.2 修订），密钥经 harness.setCredential 持久化。
      H1_MODEL_PROVIDER_ID: DEFAULT_PROVIDER_ID,
      H1_MODEL_CREDENTIAL_REF: "device-key",
    }, false), {
      driver,
      // P4-2：设备模型经 Provider 路由（§5.1.2）——配置/密钥来自持久存储，传输走 ocrHTTP。
      model: new ProviderRouterModelClient({
        providers,
        credentials,
        createProtocolClient: createDeviceProtocolClient,
      }),
      roleConfigStore: roles,
      // b17 §11：工具超时改走 MN Utils delay（裸 setTimeout 在 JSB 约 30s 才触发）。
      toolTimer: deviceToolTimer,
      toolProtocolVersion: 2,
    })
    const handler = createBridgeHandler({
      interactions: app.interactions,
      service: app.service,
      repository: app.repository,
      syncService: app.syncService,
      statisticsEngine: app.statisticsEngine,
      runStore: app.runStore,
      evidenceStore: app.evidenceStore,
      providers,
      credentials,
      roles,
      capabilities: app.capabilities,
      compactions: app.compactions,
      telemetry: app.telemetry,
      sourceBaseline: app.sourceBaseline,
      createProtocolClient: createDeviceProtocolClient,
      modelCatalog: createDeviceModelCatalog,
    })
    runtime = { app, handle: (command, data) => handler(command, data) }
  }
  return runtime
}

/** 快照来源标识（与 buildSnapshotPayload 缺省 sourceId 一致）。 */
const SNAPSHOT_SOURCE_ID = "cardlink-plugin"

type OcrSourceRow = {
  record_id: string; native_text?: string | null; ocr_text?: string | null; manual_text?: string | null; effective_text?: string | null; status?: string | null
}

/** 一次读取本地错题源（记录 + OCR 行 + 答案绑定），供同步与新鲜度检查共用同一投影口径。 */
function readLocalSourceInput(): { records: MistakeRecord[]; ocrRows: OcrSourceRow[]; bindings: Array<{ notebookId: string; rootNodeId?: string }> } {
  const records = Object.values(loadMistakeState({ persistRecovery: false }).records)
  const ocrRows = ocrStore().db.rows("SELECT record_id, native_text, ocr_text, manual_text, effective_text, status FROM ocr_questions") as unknown as OcrSourceRow[]
  const bindings: Array<{ notebookId: string; rootNodeId?: string }> = []
  for (const value of Object.values(loadBindings())) {
    const target = normalizeBinding(value)
    if (target) bindings.push({ notebookId: target.notebookId, ...(target.rootNodeId ? { rootNodeId: target.rootNodeId } : {}) })
  }
  return { records, ocrRows, bindings }
}

/**
 * v2.16 §6.1：给每条记录附加设备答案投影字段。
 * 唯一匹配 → 正文 + 实际答案笔记身份；其余显式不可用/缺失（不猜、不渲染、不伪造）。
 */
async function withAnswerProjection(records: MistakeRecord[]) {
  const projector = createAnswerTextProjector()
  let projected = 0
  let unavailable = 0
  let missing = 0
  const out: Array<Record<string, unknown>> = []
  for (const [index, record] of records.entries()) {
    if (index % 12 === 0) await delay(0.01)
    const base = record as unknown as Record<string, unknown>
    // 插件记录本身没有答案正文；若未来字段出现，按旧导入语义保留，不用投影覆盖。
    if (typeof base.answerText === "string" && base.answerText.trim()) {
      out.push(base)
      continue
    }
    const result = projector.read(record)
    if (result.status === "projected") {
      projected++
      out.push({
        ...base,
        answerText: result.text,
        answerTextOrigin: "answer_card",
        answerSourceNotebookId: result.source.notebookId,
        answerSourceNoteId: result.source.noteId,
        answerStatus: "projected",
      })
      continue
    }
    if (result.status === "missing") missing++
    else unavailable++
    out.push({ ...base, answerStatus: result.status, answerReason: result.reason })
  }
  return { records: out, projected, unavailable, missing }
}

/** JSB 侧直读插件数据 → 快照契约载荷（含 OCR 修订、设备答案投影与源指纹）。 */
async function buildHarnessSnapshotFromPlugin(): Promise<{
  payload: ReturnType<typeof buildSnapshotPayload>
  recordCount: number
  fingerprint: SourceFingerprint
  answerProjection: { projected: number; unavailable: number; missing: number }
}> {
  const input = readLocalSourceInput()
  const fingerprint = sourceFingerprint({ records: input.records, ocrRows: input.ocrRows, bindings: input.bindings })
  const projection = await withAnswerProjection(input.records)
  const payload = buildSnapshotPayload(projection.records, input.ocrRows, { sourceId: SNAPSHOT_SOURCE_ID })
  return {
    payload,
    recordCount: payload.records.length,
    fingerprint,
    answerProjection: { projected: projection.projected, unavailable: projection.unavailable, missing: projection.missing },
  }
}

/** harness.syncSnapshot 的 JSB 实现：构建 + 导入 + 摘要（不含记录数据）。 */
let snapshotSync: Promise<Record<string, unknown>> | undefined
export function syncHarnessSnapshot(full = false): Promise<Record<string, unknown>> {
  if (snapshotSync) return snapshotSync
  snapshotSync = performSnapshotSync(full).finally(() => { snapshotSync = undefined })
  return snapshotSync
}

async function performSnapshotSync(full: boolean): Promise<Record<string, unknown>> {
  // 指纹在导入前计算并随本次同步携带；只有导入成功返回快照后才写基线（§6.3）。
  const { payload, recordCount, fingerprint, answerProjection } = await buildHarnessSnapshotFromPlugin()
  const { app } = harnessRuntime()
  const result = await app.syncService.importSnapshot(payload, { preferIncremental: !full })
  let freshness: { status: string; dataAsOf?: string; snapshotId: string; warning?: string }
  try {
    app.sourceBaseline.set(SNAPSHOT_SOURCE_ID, fingerprint.fingerprint, result.snapshotId)
    const meta = await app.repository.getLatestSnapshotMeta()
    freshness = { status: "current", snapshotId: result.snapshotId, ...(meta?.dataAsOf ? { dataAsOf: meta.dataAsOf } : {}) }
  } catch (error) {
    freshness = {
      status: "unknown",
      snapshotId: result.snapshotId,
      warning: `快照已导入，但本地源基线写入失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return {
    snapshotId: result.snapshotId,
    recordCount,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    carried: result.carried,
    repaired: result.repaired,
    markedMissing: result.markedMissing ?? 0,
    warnings: result.warnings,
    sourceKind: result.sourceKind,
    answerProjection,
    trackedDimensions: fingerprint.tracked,
    freshness,
  }
}

/**
 * v2.16 §6.3：本地源新鲜度（只读、无外网、不扫描学习集）。
 * current/stale/unknown 由「当前投影指纹 == 基线指纹 且 基线快照 == 最新快照」判定；
 * 答案卡片正文变化没有轻量信号，明确标注 not_tracked，不谎报 current。
 */
export async function getHarnessDataFreshness(): Promise<Record<string, unknown>> {
  const { app } = harnessRuntime()
  const baseline = app.sourceBaseline.get(SNAPSHOT_SOURCE_ID)
  const meta = await app.repository.getLatestSnapshotMeta()
  const snapshotId = meta?.snapshotId ?? "none"
  let current: SourceFingerprint | undefined
  let sourceError: string | undefined
  try {
    const input = readLocalSourceInput()
    current = sourceFingerprint({ records: input.records, ocrRows: input.ocrRows, bindings: input.bindings })
  } catch (error) {
    sourceError = error instanceof Error ? error.message : String(error)
  }
  let status: "current" | "stale" | "unknown"
  let reason: string | undefined
  if (!current) {
    status = "unknown"
    reason = `source_unreadable: ${sourceError ?? "本地错题源不可读"}`
  } else {
    const judgement = judgeFreshness({ baseline, currentFingerprint: current.fingerprint, latestSnapshotId: snapshotId })
    status = judgement.status
    reason = judgement.reason
  }
  return {
    status,
    ...(reason ? { reason } : {}),
    snapshotId,
    ...(meta?.dataAsOf ? { dataAsOf: meta.dataAsOf } : {}),
    baselineSnapshotId: baseline?.snapshotId,
    baselineFingerprintAt: baseline?.updatedAt,
    checkedAt: new Date().toISOString(),
    counts: current?.counts,
    tracked: current?.tracked,
    answerChanges: "not_tracked",
    answerChangesNote: "答案卡片正文的修改没有轻量本地信号；如需最新答案文本，请同步快照。",
  }
}

/**
 * v2.4 §10.1.1/§13.1：证据跳转——按 recordId 打开 MarginNote 原始卡片。
 * 来源 ID 分字段读取（禁止 split(':') 解析，§0.6）；来源失效显式报错（§5.4）。
 * 不从模型输出构造任意跳转：只按插件记录里的 sourceNoteId/sourceNotebookId 导航。
 */
export async function locateRecordByPlugin(recordId: string): Promise<{ ok: boolean; message?: string }> {
  const records = loadMistakeState({ persistRecovery: false }).records
  const record = records[recordId]
  if (!record) return { ok: false, message: "原始卡片不可访问：错题记录不在当前插件数据中" }
  const noteId = String(record.sourceNoteId ?? "")
  const notebookId = String(record.sourceNotebookId ?? "")
  if (!noteId || !notebookId) return { ok: false, message: "原始卡片不可访问：缺少来源卡片标识" }
  try {
    const hint = await openNoteInMindMap(noteId, notebookId)
    return { ok: true, message: hint }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "原始卡片不可访问" }
  }
}

/** rails-core 入口：harnessCall {command, data} → §13 白名单命令（快照同步在 JSB 侧拦截实现）。 */
export async function harnessCall(command: string, data: Record<string, unknown> = {}, owner?: any): Promise<BridgeResult> {
  if (command === "harness.syncSnapshot") {
    if (data.full !== undefined && typeof data.full !== "boolean") {
      return { ok: false, error: { code: "invalid_args", message: "full 必须是布尔值" } }
    }
    return { ok: true, data: await syncHarnessSnapshot(data.full === true) }
  }
  if (command === "harness.getDataFreshness") {
    try {
      return { ok: true, data: await getHarnessDataFreshness() }
    } catch (error) {
      return { ok: false, error: { code: "freshness_unavailable", message: error instanceof Error ? error.message : "无法判断本地数据新鲜度" } }
    }
  }
  if (command === "plugin.previewRecord" || command === "plugin.previewAnswer" || command === "plugin.startReviewQueue") {
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : ""
    const branchId = typeof data.branchId === "string" ? data.branchId : sessionId
    const recordId = typeof data.recordId === "string" ? data.recordId : ""
    const artifactId = typeof data.artifactId === "string" ? data.artifactId : ""
    if (!sessionId || sessionId.length > 200 || recordId.length > 256 || artifactId.length > 80) {
      return { ok: false, error: { code: "invalid_args", message: "请求缺少有效的会话或内容标识" } }
    }
    try {
      const { app } = harnessRuntime()
      const view = app.service.branchView(sessionId, branchId)
      const session = await app.service.getSession(view.branchId)
      if (!session || session.deletedAt) return { ok: false, error: { code: "not_found", message: "会话不可用" } }
      const inScope = (record: MistakeRecord) => !session.scope.notebookIds.length || session.scope.notebookIds.includes(record.sourceNotebookId)
      const stored = session.messages.flatMap((message) => {
        if (message.type !== "tool_result" || message.status !== "ok") return []
        const envelope = message.content as { ok?: boolean; tool?: string; data?: any; evidence?: { recordIds?: string[] } }
        return envelope.ok ? [envelope] : []
      })
      const records = loadMistakeState({ persistRecovery: false }).records
      if (command === "plugin.startReviewQueue") {
        const queue = stored.find((result) => result.tool === "buildReviewQueue" && result.data?.artifactId === artifactId)
        if (!queue || !Array.isArray(queue.data?.items)) return { ok: false, error: { code: "not_found", message: "当前分支无此复习队列" } }
        const items = queue.data.items.slice(0, 50).flatMap((item: { recordId: string }) => {
          const current = records[item.recordId]
          if (!current || !inScope(current)) return []
          const note = MN.db.getNoteById(current.sourceNoteId)
          return note && !isNSNull(note) ? [current] : []
        })
        const skipped = queue.data.items.length - items.length
        if (!items.length) return { ok: false, error: { code: "not_found", message: "队列中的原题均已不可用" } }
        return { ok: true, data: { ...(await startReviewMode(items, owner)), skipped } }
      }

      const record = records[recordId]
      const isolated = command === "plugin.previewAnswer" || data.questionOnly === true
      if (!record || !inScope(record) || (isolated && !stored.some((result) => result.evidence?.recordIds?.includes(recordId)))) {
        return { ok: false, error: { code: "not_found", message: "原题不可访问" } }
      }
      if (command === "plugin.previewAnswer") return { ok: true, data: harnessMatchedAnswers(record) }
      return { ok: true, data: {
        questionHtml: isolated ? harnessQuestionExcerpt(record) : previewQuestionHtml(record), title: record.sourceTitle,
      } }
    } catch (error) {
      return { ok: false, error: { code: "preview_failed", message: error instanceof Error ? error.message : "加载失败" } }
    }
  }
  if (command === "plugin.locateRecord") {
    const recordId = String(data.recordId ?? "").trim()
    if (!recordId || recordId.length > 200) {
      return { ok: false, error: { code: "invalid_args", message: "recordId 非法" } }
    }
    const result = await locateRecordByPlugin(recordId)
    return result.ok
      ? { ok: true, data: { recordId, located: true, message: result.message } }
      : { ok: false, error: { code: "locate_failed", message: result.message ?? "原始卡片不可访问" } }
  }
  return harnessRuntime().handle(command, data)
}
