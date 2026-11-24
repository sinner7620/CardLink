import { delay, MN } from "marginnote"
import { getBindingForMode, usesSubcardAnswers } from "./binding"
import { answerReferenceIds } from "./matcher"
import { recordRuntimeState } from "./note-navigation"
import { loadMatcherSettings } from "./settings"
import { loadBindings } from "./store"

/**
 * MN5 场景模式的分支折叠写入与读回。
 *
 * 写路径只有一条：已授权的场景面板调用官方 `mn.api('/notes/fold', …)`。
 * 读路径只在当前窗口按题卡 ID 读取 JSB `mindmapBranchClose`，再用当前画布
 * 上已渲染的节点核对，不做学习集级别的扫描。响应里的 `folded` / `changed`
 * 只作为诊断信息，是否写入成功一律以读回为准。
 */

const FOLD_SCOPE = "分支折叠"
const READBACK_ATTEMPTS = 4
const READBACK_INTERVAL = 0.12

function message(error: unknown): string {
  return String((error as Error)?.message || error || "")
}

function log(label: string, detail = ""): void {
  try { recordRuntimeState(FOLD_SCOPE, label, detail) } catch { /* 诊断日志失败不影响折叠流程 */ }
  try { console.log(`CardLink 分支折叠 ${label}${detail ? `：${detail}` : ""}`) } catch { /* 控制台不可用 */ }
}

/** 供会话层写同一份精简诊断。 */
export function logFoldEvent(label: string, detail = ""): void {
  log(label, detail)
}

function currentNotebookId(): string {
  return String((MN.notebookController as any)?.notebookId ?? MN.currnetNotebookId ?? "").trim()
}

function noteById(noteId: string): any {
  try { return MN.db.getNoteById(noteId) } catch { return undefined }
}

function noteIdOf(note: any): string {
  return String(note?.noteId ?? "").trim()
}

function sameId(left: string, right: string): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase()
}

/** 按 ID 读取分支折叠状态；字段缺失或不可解析时返回 undefined。 */
export function readBranchFolded(noteId: string): boolean | undefined {
  if (!noteId) return undefined
  const value = noteById(noteId)?.mindmapBranchClose
  if (typeof value === "number") return Number.isFinite(value) ? value !== 0 : undefined
  if (value === true || value === false) return value
  return undefined
}

/** 当前题目的直接子卡（只读一张卡的 JSB 字段，不遍历学习集）。 */
export function directChildIds(noteId: string): string[] {
  let children: any[] = []
  try { children = Array.from(noteById(noteId)?.childNotes ?? []) } catch { children = [] }
  return children.map(noteIdOf).filter(Boolean)
}

/**
 * 画面证据。
 *
 * 公开资料里 `MindMapView.mindmapNodes` 是"脑图中的所有节点"（模型列表），
 * `MindMapNode.frame` 是节点在脑图视图中的位置与大小（模型坐标）。两者都不代表
 * 卡片此刻真的画在屏幕上：收起分支后模型列表仍可保留子节点（见 2026-11-23 设备日志
 * 13:19:08 `changed=1`、`read=true`，而模型列表仍有答案 ID）。因此本模块只用两种证据：
 * 宿主明确给出的视图对象（`MindMapView.selViewLst` 每项的 `view`），以及画布本身是否就绪。
 * 没有视图对象时为 `unknown`，既不算"可见"也不算"已隐藏"。
 */
export interface FoldVisibility {
  folded?: boolean
  /** 有选中视图且确实附着在视图树里的答案子卡数量（正面渲染证据）。 */
  visibleAnswers: number
  /** 有选中记录但视图未附着或不可见的答案子卡数量（弱证据，仅用于诊断）。 */
  detachedSelections: number
  /** 证据来源。 */
  source: "selection-view" | "none"
  /** 画布是否已就绪：有父视图与有效尺寸。 */
  canvasReady: boolean
  /** 目标题卡自身的视图是否已附着（诊断用）。 */
  targetAttached: boolean
  /** 当前题的直接子卡数量。 */
  children: number
}

function mapView(): any {
  try { return MN.notebookController?.mindmapView } catch { return undefined }
}

/** 画布是否就绪：挂在视图树里且有有效尺寸；不做任何绘制推断。 */
function canvasReady(map: any): boolean {
  try {
    if (!map || !map.superview) return false
    const bounds = map.bounds
    const width = Number(bounds?.width ?? 0), height = Number(bounds?.height ?? 0)
    return width > 0 && height > 0
  } catch { return false }
}

/** 宿主提供的视图是否真的附着在视图树里且可见（UIKit 属性，项目其它模块同样使用）。 */
function viewVisible(view: any): boolean | undefined {
  if (!view || typeof view !== "object") return undefined
  let node = view
  let depth = 0
  try {
    while (node && depth < 24) {
      if (node.hidden === true) return false
      const alpha = Number(node.alpha)
      if (Number.isFinite(alpha) && alpha <= 0.01) return false
      const opacity = Number(node.layer?.opacity)
      if (Number.isFinite(opacity) && opacity <= 0.01) return false
      const parent = node.superview
      if (!parent) return depth > 0
      node = parent
      depth++
    }
    return true
  } catch {
    return undefined
  }
}

/** `selViewLst` 里的真实视图：题卡 ID → UIView。 */
function selectionViews(): Map<string, any> {
  const views = new Map<string, any>()
  try {
    for (const item of Array.from(mapView()?.selViewLst ?? []) as any[]) {
      const id = String(item?.note?.note?.noteId ?? item?.note?.noteId ?? "").trim()
      if (!id || !item?.view) continue
      views.set(id.toLowerCase(), item.view)
    }
  } catch { /* 画布不可读时没有视图证据 */ }
  return views
}

/** 收集当前题的画面证据；只读当前题卡与其直接子卡。 */
export function foldVisibility(noteId: string): FoldVisibility {
  const map = mapView()
  const children = noteId ? directChildIds(noteId) : []
  const selected = selectionViews()
  let visibleAnswers = 0, detachedSelections = 0
  for (const child of children) {
    const view = selected.get(child.toLowerCase())
    if (!view) continue
    const visible = viewVisible(view)
    if (visible === true) visibleAnswers++
    else if (visible === false) detachedSelections++
  }
  const targetView = selected.get(String(noteId).toLowerCase())
  return {
    folded: readBranchFolded(noteId),
    visibleAnswers,
    detachedSelections,
    source: visibleAnswers > 0 || detachedSelections > 0 || targetView ? "selection-view" : "none",
    canvasReady: canvasReady(map),
    targetAttached: targetView ? viewVisible(targetView) === true : false,
    children: children.length
  }
}

/** 精简诊断：状态、证据来源、画布是否就绪。 */
export function describeVisibility(visibility: FoldVisibility): string {
  return `folded=${visibility.folded === undefined ? "?" : visibility.folded}` +
    ` visible=${visibility.visibleAnswers}/${visibility.children}` +
    ` detached=${visibility.detachedSelections}` +
    ` source=${visibility.source}` +
    ` canvas=${visibility.canvasReady ? "ready" : "notReady"}` +
    ` target=${visibility.targetAttached ? "attached" : "unknown"}`
}

export type FoldConfirmationState = "confirmed" | "applied" | "contradicted" | "unknown"

export interface FoldConfirmation {
  state: FoldConfirmationState
  visibility: FoldVisibility
}

/**
 * 折叠/展开是否达成。
 *
 * - `unknown`：读不到 `mindmapBranchClose`，或字段与目标不一致。
 * - `contradicted`：字段已收起，但有子卡真实视图仍附着在画面上（可见即没藏住）。
 * - `confirmed`：展开目标 + 子卡视图可见，或收起目标且不存在任何画面证据之外的矛盾。
 *   收起方向不再据此宣称"已确认"：没有可靠证据能证明卡片确实没画出来。
 * - `applied`：字段已到目标状态，画面证据为 unknown（模型已收起，但无法证明画面已隐藏）。
 */
export function foldConfirmation(noteId: string, folded: boolean): FoldConfirmation {
  const visibility = foldVisibility(noteId)
  if (visibility.folded === undefined || visibility.folded !== folded) return { state: "unknown", visibility }
  if (folded) {
    if (visibility.visibleAnswers > 0) return { state: "contradicted", visibility }
    return { state: "applied", visibility }
  }
  return visibility.visibleAnswers > 0 ? { state: "confirmed", visibility } : { state: "unknown", visibility }
}



export interface FoldSceneSession { available: boolean; token: string; reason?: string }

/** 已授权、已确认可用的场景面板会话；没有会话时不创建面板。 */
export function foldSceneSession(owner: any): FoldSceneSession {
  const scene = (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__
  if (!scene) return { available: false, token: "", reason: "当前宿主没有场景面板" }
  try {
    if (typeof scene.foldBranch !== "function") return { available: false, token: "", reason: "场景面板未提供分支折叠通道" }
    if (typeof scene.enabled !== "function" || !scene.enabled(owner)) return { available: false, token: "", reason: "场景面板尚未授权或未就绪" }
    const token = typeof scene.sceneToken === "function" ? String(scene.sceneToken(owner) ?? "") : ""
    return { available: true, token }
  } catch (error) {
    return { available: false, token: "", reason: message(error) }
  }
}

export interface FoldEligibility { eligible: boolean; reason?: string; capability: boolean }

/**
 * 折叠优先的前置条件：场景能力、当前题实际绑定的直接子卡答案、整支可安全收起。
 * `capability` 表示"宿主没有折叠能力"，据此决定是否提示改用遮盖。
 */
export function foldEligibility(notebookId: string, questionId: string, rootNodeId?: string): FoldEligibility {
  const note = noteById(questionId)
  if (!note) return { eligible: false, reason: "题目卡片已不存在", capability: false }
  const current = currentNotebookId()
  if (current && notebookId && current !== notebookId) return { eligible: false, reason: "当前学习集与题目不一致", capability: false }
  if (readBranchFolded(questionId) === undefined) return { eligible: false, reason: "无法读取当前题目的分支状态", capability: true }
  const target = getBindingForMode(loadBindings(), notebookId, rootNodeId, loadMatcherSettings().allowSameStudySetMindMap)
  if (!target) return { eligible: false, reason: "当前脑图尚未绑定答案", capability: false }
  if (!usesSubcardAnswers(target, note.colorIndex)) return { eligible: false, reason: "当前题目的答案不在直接子卡中", capability: false }
  const children = directChildIds(questionId)
  if (!children.length) return { eligible: false, reason: "所选题目没有直接子卡片答案", capability: false }
  for (const child of children) {
    const childNote = noteById(child)
    if (!childNote) return { eligible: false, reason: "无法确认直接子卡的身份", capability: false }
    const owner = String(childNote.notebookId ?? "").trim()
    if (owner && notebookId && !sameId(owner, notebookId)) return { eligible: false, reason: "直接子卡不属于当前学习集", capability: false }
    // 下层还有卡片时，不遍历全图就无法证明整支可隐藏；按规范保守回退到遮盖。
    if (directChildIds(child).length) {
      return { eligible: false, reason: "答案子卡下还有下层卡片，无法确认整支可收起", capability: false }
    }
  }
  // 混合绑定下直接子卡不一定都是答案；只有索引能证明整支都是答案时才折叠。
  if (target.selectionMode === "mixed") {
    let answers: Set<string>
    try { answers = answerReferenceIds({ notebookId: target.notebookId, rootNodeId: target.rootNodeId }) }
    catch { return { eligible: false, reason: "答案索引未就绪，无法确认整支只含答案", capability: false } }
    if (children.some(id => !answers.has(id))) return { eligible: false, reason: "题目分支混有非答案卡片", capability: false }
  }
  return { eligible: true, capability: true }
}

export type FoldStatus = "unchanged" | "confirmed" | "applied" | "contradicted" | "unverified" | "skipped" | "error"

export interface FoldOutcome {
  status: FoldStatus
  /** 本次是否向宿主发出了写入请求（用于区分尚未写入和结果未知）。 */
  wrote: boolean
  folded?: boolean
  topicid?: string
  skippedReason?: string
  error?: string
}

export interface FoldWriteRequest {
  owner: any
  notebookId: string
  noteId: string
  folded: boolean
  reason?: string
  /** 每次写入前后校验访问代次，避免迟到回执写入其它题目。 */
  isCurrent?: () => boolean
}

// 折叠、展开与恢复共用同一条串行队列。
let queueTail: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queueTail.then(task, task)
  queueTail = next.then(() => undefined, () => undefined)
  return next
}

export function writeBranchFolded(request: FoldWriteRequest): Promise<FoldOutcome> {
  return serialize(() => performFold(request))
}

async function performFold(request: FoldWriteRequest): Promise<FoldOutcome> {
  const { owner, notebookId, noteId, folded } = request
  const label = request.reason ? `${request.reason}` : folded ? "折叠" : "展开"
  if (request.isCurrent && !request.isCurrent()) {
    log(`${label}.skipped`, `noteid=${noteId} 本次访问已结束`)
    return { status: "skipped", wrote: false, error: "本次访问已结束" }
  }
  const observed = readBranchFolded(noteId)
  if (observed === undefined) {
    log(`${label}.unknownState`, `noteid=${noteId}`)
    return { status: "error", wrote: false, error: "无法读取当前题目的分支状态" }
  }
  if (observed === folded) return { status: "unchanged", wrote: false, folded: observed }
  const current = currentNotebookId()
  if (current && notebookId && current !== notebookId) {
    log(`${label}.notebookChanged`, `expect=${notebookId} current=${current}`)
    return { status: "error", wrote: false, error: "已切换学习集，未写入折叠状态" }
  }
  const scene = foldSceneSession(owner)
  if (!scene.available) {
    log(`${label}.unavailable`, scene.reason || "")
    return { status: "error", wrote: false, error: scene.reason || "场景面板未就绪" }
  }
  let reply: any
  try {
    reply = await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.foldBranch(owner, {
      noteid: noteId, notebookId, folded, reason: request.reason
    })
  } catch (error) {
    // 已派发的请求超时或场景失效不等于没有写入：只有明确未派发才算没写。
    const dispatched = (error as any)?.dispatched === true
    log(`${label}.failed`, `dispatched=${dispatched} ${message(error)}`)
    return { status: "error", wrote: dispatched, error: message(error) }
  }
  // 回执身份：题卡、窗口会话、学习集。任何一项对不上都不当作本请求的结果。
  if (!reply || typeof reply !== "object") return { status: "error", wrote: false, error: "折叠回执无效" }
  if (reply.noteid && !sameId(String(reply.noteid), noteId)) {
    log(`${label}.identityMismatch`, `expect=${noteId} reply=${String(reply.noteid)}`)
    return { status: "error", wrote: true, error: "折叠回执的题卡与当前题目不一致" }
  }
  if (reply.sceneToken && scene.token && String(reply.sceneToken) !== scene.token) {
    log(`${label}.sessionMismatch`, `expect=${scene.token} reply=${String(reply.sceneToken)}`)
    return { status: "error", wrote: true, error: "场景面板会话已变化，折叠结果未确认" }
  }
  if (reply.error) {
    log(`${label}.hostError`, `${String(reply.error)}${reply.code ? ` code=${reply.code}` : ""}`)
    return { status: "error", wrote: reply.dispatched !== false, error: String(reply.error), topicid: reply.topicid }
  }
  if (reply.topicid && notebookId && !sameId(String(reply.topicid), notebookId)) {
    log(`${label}.topicMismatch`, `expect=${notebookId} reply=${String(reply.topicid)}`)
    return { status: "error", wrote: true, error: "折叠结果属于其它学习集，未确认", topicid: String(reply.topicid) }
  }
  if (reply.sceneTopic && notebookId && !sameId(String(reply.sceneTopic), notebookId)) {
    log(`${label}.sceneTopicMismatch`, `expect=${notebookId} reply=${String(reply.sceneTopic)}`)
    return { status: "error", wrote: true, error: "写入时场景不属于目标学习集，未确认", topicid: String(reply.sceneTopic) }
  }
  if (reply.skipped?.noteid) {
    log(`${label}.skipped`, `reason=${String(reply.skipped.reason || "(无)")}`)
    return { status: "skipped", wrote: false, skippedReason: String(reply.skipped.reason || "宿主跳过该卡片") }
  }
  // 读回期间再次核对访问代次、学习集与场景会话，迟到结果不能算到下一题头上。
  let last: FoldConfirmation | undefined
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt++) {
    const drift = readbackDrift(request, scene)
    if (drift) {
      log(`${label}.readbackAborted`, `noteid=${noteId} ${drift}`)
      return { status: "unverified", wrote: true, folded: readBranchFolded(noteId), error: drift }
    }
    last = foldConfirmation(noteId, folded)
    if (last.state === "confirmed" || last.state === "applied") {
      log(`${label}.${last.state}`, `noteid=${noteId} ${describeVisibility(last.visibility)}`)
      return { status: last.state, wrote: true, folded }
    }
    if (last.state === "contradicted") {
      log(`${label}.contradicted`, `noteid=${noteId} ${describeVisibility(last.visibility)}`)
      return { status: "contradicted", wrote: true, folded: last.visibility.folded }
    }
    if (attempt < READBACK_ATTEMPTS - 1) await delay(READBACK_INTERVAL)
  }
  log(`${label}.unverified`, `noteid=${noteId} folded=${folded} ${describeVisibility(last?.visibility ?? foldVisibility(noteId))}`)
  return { status: "unverified", wrote: true, folded: readBranchFolded(noteId) }
}

/** 写入已派发后，读回前必须仍然指向同一个画面与学习集。 */
function readbackDrift(request: FoldWriteRequest, scene: FoldSceneSession): string {
  if (request.isCurrent && !request.isCurrent()) return "本次访问已结束，未确认折叠结果"
  const current = currentNotebookId()
  if (current && request.notebookId && current !== request.notebookId) return "已切换学习集，未确认折叠结果"
  if (scene.token && foldSceneSession(request.owner).token !== scene.token) return "场景面板会话已变化，未确认折叠结果"
  return ""
}
