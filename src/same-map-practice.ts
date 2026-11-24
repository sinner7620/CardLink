import { delay, MN, showHUD, type UIImage } from "marginnote"
import { decodeBase64Ascii } from "./base64"
import {
  describeVisibility, directChildIds, foldConfirmation, foldEligibility, foldSceneSession,
  foldVisibility, logFoldEvent, readBranchFolded, writeBranchFolded
} from "./mindmap-fold"
import { loadMatcherSettings } from "./settings"
import { focusNoteInMindMapFocusMode } from "./note-navigation"
import { setWindowFrame } from "./window-opacity"

type Rect = { x: number; y: number; width: number; height: number }
type Calibration = { sx: number; sy: number; tx: number; ty: number }
type MaskAppearance = { color: string; image?: UIImage }
// Retain the detached UIKit carrier: it renders color/image/text without adding
// an overlay UIView to the host's visible view tree (CardMask v0.1.5 approach).
type MaskLayer = { carrier: UIView; layer: any }

interface PracticeQueue {
  notebookId: string
  questionIds: Set<string>
  generation: number
  currentQuestionId: string
}

interface PracticeSession extends PracticeQueue {
  kind: "masked" | "fold"
  owner?: any
  rootNodeId?: string
  revealedQuestionIds: Set<string>
  canvas?: any
  calibration?: Calibration
  masks: Map<string, MaskLayer>
  appearance?: MaskAppearance
  rebinding: boolean
  fold?: FoldRun
}

/** 折叠优先的每次访问状态；只针对当前题，切换题目时重建。 */
interface FoldRun {
  questionId: string
  writes: number
  revealed: boolean
  useFold: boolean
  blocked?: string
  busy: boolean
}

interface FocusPracticeSession extends PracticeQueue {
  kind: "focus"
}

// 宿主重新展开后最多再写几次；超过即保留遮盖并停止自动折叠。
const MAX_FOLD_WRITES = 3

let active: PracticeSession | FocusPracticeSession | undefined
let nextGeneration = 0
let decodedMaskImage: { source: string; image: UIImage } | undefined
function currentNotebookId(): string {
  return String((MN.notebookController as any)?.notebookId ?? MN.currnetNotebookId ?? "").trim()
}
function rectOf(value: any, property: "frame" | "bounds" = "frame"): Rect | undefined {
  const rect = value?.[property]
  if (!rect) return
  const result = {
    x: Number(rect.x ?? 0), y: Number(rect.y ?? 0),
    width: Number(rect.width), height: Number(rect.height)
  }
  return Object.values(result).every(Number.isFinite) && result.width > 0 && result.height > 0 ? result : undefined
}

function noteId(note: any): string {
  return String(note?.noteId ?? "").trim()
}

function modelFrame(node: any): Rect | undefined {
  return rectOf(node)
}

function selectedCardView(map: any): { id: string; view: any } | undefined {
  const views = Array.from(map?.selViewLst ?? []) as any[]
  const selected = views.find(view => noteId(view?.note?.note ?? view?.note) && rectOf(view?.view ?? view, "bounds"))
  if (!selected) return
  return { id: noteId(selected.note?.note ?? selected.note), view: selected.view ?? selected }
}

async function calibrationCard(map: any, questionIds: Set<string>, isCurrent: () => boolean = () => true): Promise<{ id: string; view: any; map: any } | undefined> {
  if (!isCurrent()) return
  const current = selectedCardView(map)
  const firstQuestionId = [...questionIds][0]
  if (current?.id === firstQuestionId && current.view?.superview &&
    (Array.from(map?.mindmapNodes ?? []) as any[]).some(node => noteId(node?.note) === current.id)) {
    return { ...current, map }
  }
  if (!firstQuestionId || typeof MNUtil?.selectNotesInMindmap !== "function") return
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!isCurrent()) return
    const currentMap = MN.notebookController?.mindmapView
    const selected = selectedCardView(currentMap)
    if (selected?.id === firstQuestionId && selected.view?.superview) {
      return { ...selected, map: currentMap }
    }
    if (attempt % 3 === 0) {
      try { await MNUtil.selectNotesInMindmap([firstQuestionId], false) }
      catch { /* newly opened mind map can reject selection until its view is ready */ }
    }
    await delay(0.1)
  }
}

export function canvasCalibration(cardView: any, map: any, model: Rect): { canvas: any; calibration: Calibration } | undefined {
  const cardBounds = rectOf(cardView, "bounds")
  if (!cardBounds) return
  let child = cardView
  let converted = cardBounds
  for (let level = 1; level <= 18; level++) {
    const parent = child?.superview
    const frame = rectOf(child)
    const bounds = rectOf(child, "bounds")
    if (!parent || !frame || !bounds) break
    const sx = frame.width / bounds.width, sy = frame.height / bounds.height
    converted = {
      x: frame.x + (converted.x - bounds.x) * sx,
      y: frame.y + (converted.y - bounds.y) * sy,
      width: converted.width * sx, height: converted.height * sy
    }
    // A ranked ancestor can be a UIScrollView. Only the actual canvas owns
    // model-space overlays; never silently fall back to another view.
    if (nativeViewClass(parent).includes("MindMapCanvas")) {
      try {
        const nativeRect = cardView.convertRectToView(cardBounds, parent)
        const value = rectOf({ frame: nativeRect })
        if (value) converted = value
      } catch { /* Older JSB builds expose only frame/bounds conversion. */ }
      const sx = converted.width / model.width, sy = converted.height / model.height
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return
      if (typeof parent.layer?.addSublayer !== "function") return
      return { canvas: parent, calibration: { sx, sy, tx: converted.x - model.x * sx, ty: converted.y - model.y * sy } }
    }
    if (parent === map) break
    child = parent
  }
}

export function nativeViewClass(view: any): string {
  for (const key of ["className", "$className", "class", "$class"]) {
    try {
      const value = view[key]
      const name = String(typeof value === "function" ? value.call(view) : value ?? "")
      if (name && name !== "[object Object]") return name
    } catch { /* Try the next JSB class representation. */ }
  }
  try { return String(typeof view.description === "function" ? view.description() : view.description ?? "") }
  catch { return "" }
}

function answerFrames(map: any, questionIds: Set<string>): Map<string, Rect> {
  const answers = new Map<string, Rect>()
  for (const node of Array.from(map?.mindmapNodes ?? []) as any[]) {
    const id = noteId(node?.note)
    const parentId = noteId(node?.parentNode?.note ?? node?.note?.parentNote)
    const frame = modelFrame(node)
    if (id && parentId && questionIds.has(parentId) && frame) answers.set(id, frame)
  }
  return answers
}

function maskAppearance(): MaskAppearance {
  const settings = loadMatcherSettings()
  const source = settings.answerMaskImage
  let image: UIImage | undefined
  if (source) {
    if (!(globalThis as any).UIImageView) throw new Error("当前 MarginNote 不支持原生图片遮盖")
    if (decodedMaskImage?.source !== source) {
      const bytes = NSData.dataWithStringEncoding(decodeBase64Ascii(source), 5)
      const decoded = bytes?.length() ? UIImage.imageWithData(bytes) : undefined
      if (!decoded) throw new Error("自定义遮盖图片解码失败")
      decodedMaskImage = { source, image: decoded }
    }
    image = decodedMaskImage.image
  } else {
    decodedMaskImage = undefined
  }
  return { color: settings.answerMaskColor || (settings.answerMaskStyle === "light" ? "#d9e4f2" : "#141922"), image }
}

function sessionMaskAppearance(session: PracticeSession): MaskAppearance | undefined {
  if (session.appearance) return session.appearance
  try { session.appearance = maskAppearance() } catch { return undefined }
  return session.appearance
}

function makeMask(appearance: MaskAppearance): MaskLayer {
  // UIKit performs the color bridge; no UIColor.CGColor / UIImage.CGImage
  // access is needed, including on builds where those properties throw.
  const mask = new UIView({ x: 0, y: 0, width: 1, height: 1 })
  mask.backgroundColor = UIColor.colorWithHexString(appearance.color).colorWithAlphaComponent(1)
  mask.layer.cornerRadius = 8
  mask.layer.masksToBounds = true
  ;(mask as any).userInteractionEnabled = false
  if (appearance.image) {
    const imageView = new (globalThis as any).UIImageView({ x: 0, y: 0, width: 1, height: 1 })
    imageView.image = appearance.image
    imageView.contentMode = 2
    imageView.layer.masksToBounds = true
    imageView.userInteractionEnabled = false
    mask.addSubview(imageView)
  }
  const Label = UILabel as any
  const label = new Label({ x: 6, y: 0, width: 1, height: 38 }) as UILabel
  label.text = "答案已遮盖"
  label.textAlignment = 1
  label.textColor = ["#d9e4f2", "#f6e7a5", "#d8f0d2"].includes(appearance.color)
    ? UIColor.colorWithHexString("#17345f") : UIColor.whiteColor()
  ;(label as any).userInteractionEnabled = false
  mask.addSubview(label)
  return { carrier: mask, layer: mask.layer }
}

function clearMasks(session: PracticeSession): void {
  for (const mask of session.masks.values()) {
    try { mask.layer.removeFromSuperlayer() } catch { /* detached canvas */ }
  }
  session.masks.clear()
}

function canvasInMindMap(canvas: any, map: any): boolean {
  for (let view = canvas, level = 0; view && level <= 18; view = view.superview, level++) {
    if (view === map) return true
  }
  return false
}

function updateMask(session: PracticeSession, folded = session.kind === "fold" && session.fold?.useFold !== false &&
  foldConfirmation(session.currentQuestionId, true).state === "applied"): boolean {
  const notebookId = currentNotebookId()
  if (active !== session || (notebookId && notebookId !== session.notebookId)) return false
  const questions = new Set([...session.questionIds].filter(id =>
    !session.revealedQuestionIds.has(id) && !(folded && id === session.currentQuestionId)
  ))
  if (!questions.size) {
    clearMasks(session)
    return true
  }
  if (!session.canvas?.superview) return false
  const map = MN.notebookController?.mindmapView
  if (!map) return true
  if (!canvasInMindMap(session.canvas, map)) return false
  const wanted = answerFrames(map, questions)
  // 答案已经不再渲染（例如分支已收起）时先摘掉旧遮盖，避免留下浮空的遮盖块。
  for (const [id, mask] of session.masks) {
    if (!wanted.has(id)) {
      mask.layer.removeFromSuperlayer()
      session.masks.delete(id)
    }
  }
  if (!wanted.size) return true
  const appearance = sessionMaskAppearance(session)
  if (!appearance) return false
  let covered = 0
  for (const [id, frame] of wanted) {
    const { sx, sy, tx, ty } = session.calibration!
    const target = { x: tx + frame.x * sx, y: ty + frame.y * sy, width: frame.width * sx, height: frame.height * sy }
    if (target.width <= 4 || target.height <= 4) continue
    let mask = session.masks.get(id)
    if (!mask) {
      mask = makeMask(appearance)
      session.masks.set(id, mask)
    }
    updateMaskLayer(mask, target, session.canvas.layer)
    covered++
  }
  return covered > 0
}

function updateMaskLayer(mask: MaskLayer, target: Rect, parentLayer: any): void {
  const transaction = (globalThis as any).CATransaction
  const transact = typeof transaction?.begin === "function" && typeof transaction?.setDisableActions === "function" && typeof transaction?.commit === "function"
  if (transact) { transaction.begin(); transaction.setDisableActions(true) }
  try {
    setWindowFrame(mask.carrier, target)
    mask.layer.opacity = 1
    const subviews = Array.from((mask.carrier as any).subviews ?? []) as any[]
    if (subviews.length > 1) setWindowFrame(subviews[0], { x: 0, y: 0, width: target.width, height: target.height })
    const label = subviews[subviews.length - 1]
    if (label) setWindowFrame(label, { x: 6, y: Math.max(0, target.height / 2 - 19), width: Math.max(0, target.width - 12), height: 38 })
    // Reattach only after host detachment, rather than reordering every tick.
    if (mask.layer.superlayer !== parentLayer) parentLayer.addSublayer(mask.layer)
  } finally { if (transact) transaction.commit() }
}

async function rebindMask(session: PracticeSession): Promise<void> {
  if (session.rebinding || active !== session) return
  const map = MN.notebookController?.mindmapView
  const visibleIds = new Set((Array.from(map?.mindmapNodes ?? []) as any[])
    .map(node => noteId(node?.note)).filter(id => session.questionIds.has(id)))
  if (!visibleIds.size) return
  const selectedId = selectedCardView(map)?.id
  const calibrationId = selectedId && visibleIds.has(selectedId) ? selectedId : [...visibleIds][0]
  session.rebinding = true
  try {
    const card = await calibrationCard(map, new Set([calibrationId]), () => active === session &&
      (!currentNotebookId() || currentNotebookId() === session.notebookId))
    const notebookId = currentNotebookId()
    if (active !== session || !card || (notebookId && notebookId !== session.notebookId)) return
    const currentMap = card.map
    const node = (Array.from(currentMap.mindmapNodes ?? []) as any[]).find(item => noteId(item?.note) === card.id)
    const frame = modelFrame(node)
    const placement = frame && canvasCalibration(card.view, currentMap, frame)
    if (!placement?.canvas?.superview) return
    clearMasks(session)
    session.canvas = placement.canvas
    session.calibration = placement.calibration
    updateMask(session)
  } catch {
    // The map view can disappear while focus mode is rebuilding; retry on the next tick.
  } finally {
    session.rebinding = false
  }
}

function schedule(session: PracticeSession): void {
  NSTimer.scheduledTimerWithTimeInterval(0.16, false, () => {
    if (active !== session || session.generation !== nextGeneration) return
    const notebookId = currentNotebookId()
    if (notebookId && notebookId !== session.notebookId) return stopSameMapPractice()
    try {
      if (session.kind === "fold") monitorFoldSession(session)
      else if (!updateMask(session)) void rebindMask(session)
    } catch {
      void rebindMask(session)
    }
    schedule(session)
  })
}

function hintFoldFallback(owner: any, reason: string, capability: boolean): void {
  if (!owner || owner.cardLinkFoldFallbackHinted) return
  owner.cardLinkFoldFallbackHinted = true
  // 现有 160 毫秒同步不是零闪现保证；提示只说明本轮改按遮盖处理，不承诺已折叠。
  showHUD(capability
    ? `未启用折叠优先（${reason}），本题改按遮盖处理`
    : `本题分支不能整体收起（${reason}），改按遮盖处理`, 4)
}

/** 新一轮做题或复习开始时允许再次提示折叠回退原因。 */
export function resetFoldFallbackHint(owner: any): void {
  if (owner) owner.cardLinkFoldFallbackHinted = false
}

function foldRun(session: PracticeSession, questionId: string): FoldRun {
  if (!session.fold || session.fold.questionId !== questionId) {
    session.fold = { questionId, writes: 0, revealed: false, busy: false, useFold: true }
  }
  return session.fold
}

function foldBudgetLeft(fold: FoldRun): boolean {
  return fold.writes < MAX_FOLD_WRITES
}

function blockFold(session: PracticeSession, fold: FoldRun, reason: string): void {
  fold.blocked = reason
  hintFoldFallback(session.owner, reason, true)
}

/**
 * 先按 ID 收起当前题分支并读回，再让调用方移动焦点。
 * 返回 ready 表示宿主折叠字段已到收起状态；画面是否有卡片证据由会话层继续跟踪。
 */
async function prepareFoldEntry(
  notebookId: string, questionId: string, options: { owner?: any; rootNodeId?: string; isCurrent?: () => boolean }
): Promise<FoldEntryPlan> {
  const scene = foldSceneSession(options.owner)
  if (!scene.available) return { ready: false, capability: true, reason: scene.reason || "场景面板未就绪" }
  const eligibility = foldEligibility(notebookId, questionId, options.rootNodeId)
  if (!eligibility.eligible) return { ready: false, capability: eligibility.capability, reason: eligibility.reason }
  const folded = readBranchFolded(questionId)
  if (folded === undefined) return { ready: false, capability: true, reason: "无法读取当前题目的分支折叠状态" }
  if (folded) {
    logFoldEvent("enter.alreadyFolded", `noteid=${questionId} ${describeVisibility(foldVisibility(questionId))}`)
    return { ready: true, capability: true, writes: 0 }
  }
  const outcome = await writeBranchFolded({
    owner: options.owner, notebookId, noteId: questionId, folded: true, reason: "enter", isCurrent: options.isCurrent
  })
  if (foldAccepted(outcome.status)) {
    logFoldEvent("enter.applied", `noteid=${questionId} status=${outcome.status} ${visibilityDetail(questionId, outcome)}`)
    return { ready: true, capability: true, writes: outcome.wrote ? 1 : 0 }
  }
  logFoldEvent("enter.fallback", `noteid=${questionId} status=${outcome.status} ${visibilityDetail(questionId, outcome)}`)
  return {
    ready: false, capability: true,
    reason: outcome.skippedReason || outcome.error || "未能在定位前收起题卡分支"
  }
}

/** 折叠写入被宿主接受：字段已到收起状态（画面证据另行判断）。 */
function foldAccepted(status: string): boolean {
  return status === "confirmed" || status === "applied" || status === "unchanged" || status === "contradicted"
}

function visibilityDetail(questionId: string, outcome: { status: string; error?: string }): string {
  const extra = outcome.error ? ` reason=${outcome.error}` : ""
  return `${describeVisibility(foldVisibility(questionId))} outcome=${outcome.status}${extra}`
}

/**
 * 焦点后读回：定位可能重新展开分支，此时至多再写一次。
 * 字段收起时由遮盖同步继续处理仍可见的子卡。
 */
async function settleFoldFocus(session: PracticeSession, questionId: string): Promise<boolean> {
  const fold = foldRun(session, questionId)
  const first = foldConfirmation(questionId, true)
  if (first.visibility.folded === true) {
    logFoldEvent("settle." + first.state, `noteid=${questionId} ${describeVisibility(first.visibility)}`)
    return true
  }
  if (first.visibility.folded === undefined) {
    blockFold(session, fold, "定位后无法读取分支状态")
    return false
  }
  if (!foldBudgetLeft(fold)) { blockFold(session, fold, "宿主反复展开题卡分支"); return false }
  fold.writes++
  const outcome = await writeBranchFolded({
    owner: session.owner, notebookId: session.notebookId, noteId: questionId, folded: true, reason: "refocus",
    isCurrent: () => active === session && session.generation === nextGeneration
  })
  if (!foldAccepted(outcome.status)) {
    blockFold(session, fold, outcome.error || outcome.skippedReason || "定位后未能收起题卡分支")
    logFoldEvent("settle.failed", `noteid=${questionId} ${visibilityDetail(questionId, outcome)}`)
    return false
  }
  const recheck = foldConfirmation(questionId, true)
  logFoldEvent("settle." + recheck.state, `noteid=${questionId} ${describeVisibility(recheck.visibility)}`)
  return recheck.visibility.folded === true
}

function monitorFoldSession(session: PracticeSession): void {
  const fold = session.fold
  const noteId = session.currentQuestionId
  if (fold?.useFold === false) {
    if (!updateMask(session, false)) void rebindMask(session)
    return
  }
  const confirmation = foldConfirmation(noteId, true)
  // 展开或仍可见时先遮盖，收起时跳过模型里的旧卡片坐标。
  const rebind = updateMask(session, confirmation.state === "applied") ? undefined : rebindMask(session)
  if (!fold || fold.busy || fold.revealed || fold.blocked) return
  if (confirmation.visibility.folded === true) return
  if (confirmation.visibility.folded === undefined) {
    blockFold(session, fold, "无法读取分支折叠状态")
    logFoldEvent("monitor.blocked", `noteid=${noteId} ${describeVisibility(confirmation.visibility)}`)
    return
  }
  // 一次原生展开只补写一次折叠。
  if (!foldBudgetLeft(fold)) { blockFold(session, fold, "宿主反复展开题卡分支"); return }
  fold.busy = true
  fold.writes++
  const isCurrent = () => active === session && session.generation === nextGeneration && session.currentQuestionId === noteId
  void (async () => {
    try {
      if (rebind) await rebind
      if (!isCurrent()) return
      const outcome = await writeBranchFolded({
        owner: session.owner, notebookId: session.notebookId, noteId, folded: true, reason: "reexpand",
        isCurrent
      })
      if (!isCurrent()) return
      if (foldAccepted(outcome.status)) {
        logFoldEvent("monitor.refolded", `noteid=${noteId} ${visibilityDetail(noteId, outcome)}`)
        if (!updateMask(session)) void rebindMask(session)
        return
      }
      blockFold(session, fold, outcome.error || outcome.skippedReason || "未能收起题卡分支")
      logFoldEvent("monitor.blocked", `noteid=${noteId} ${visibilityDetail(noteId, outcome)}`)
    } catch (error) {
      if (isCurrent()) blockFold(session, fold, String((error as Error)?.message || error))
    } finally {
      fold.busy = false
    }
  })()
}

export function sameMapPracticeActive(): boolean {
  const notebookId = currentNotebookId()
  if (active && notebookId && active.notebookId !== notebookId) stopSameMapPractice()
  return !!active
}

export function sameMapPracticeQuestionIds(): string[] {
  return sameMapPracticeActive() && active ? [...active.questionIds] : []
}

export function sameMapPracticeCurrentQuestionId(): string | undefined {
  if (!sameMapPracticeActive() || !active) return
  return active.currentQuestionId
}

/** 本次做题是否以折叠优先保护当前题。 */
export function sameMapPracticeFoldFirst(): boolean {
  return sameMapPracticeActive() && active?.kind === "fold"
}

/**
 * 进入下一题前先收起它的分支。用于复习模式：定位动作由调用方执行，
 * 因此折叠写入必须先于焦点移动。`isCurrent` 由调用方给出访问代次判据。
 */
export async function preFoldCurrentQuestion(notebookId: string, questionId: string, owner: any, rootNodeId?: string, isCurrent?: () => boolean): Promise<boolean> {
  const current = () => !isCurrent || isCurrent()
  if (!current()) return false
  const scene = foldSceneSession(owner)
  if (!scene.available) return false
  const eligibility = foldEligibility(notebookId, questionId, rootNodeId)
  if (!eligibility.eligible) return false
  const folded = readBranchFolded(questionId)
  if (folded === undefined) return false
  if (folded) return true
  const outcome = await writeBranchFolded({ owner, notebookId, noteId: questionId, folded: true, reason: "prefocus", isCurrent: current })
  return foldAccepted(outcome.status) && current()
}

export async function navigateSameMapPractice(questionId: string): Promise<boolean> {
  if (!sameMapPracticeActive()) return false
  const session = active
  if (!session?.questionIds.has(questionId)) return false
  const previous = session.currentQuestionId
  const isCurrent = () => active === session && session.generation === nextGeneration &&
    session.currentQuestionId === previous && (!currentNotebookId() || currentNotebookId() === session.notebookId)
  let entry: FoldEntryPlan | undefined
  if (session.kind === "fold" && questionId !== previous) {
    entry = await prepareFoldEntry(session.notebookId, questionId, {
      owner: session.owner, rootNodeId: session.rootNodeId, isCurrent
    })
    if (!isCurrent()) return false
  }
  if (await focusNoteInMindMapFocusMode(questionId) !== "focused") {
    showHUD("无法定位并聚焦当前题目卡片", 3)
    return false
  }
  if (!isCurrent()) return false
  session.currentQuestionId = questionId
  if (session.kind === "fold") {
    const fold = foldRun(session, questionId)
    if (entry && !entry.ready) {
      fold.useFold = false
      if (entry.reason) hintFoldFallback(session.owner, entry.reason, entry.capability)
      if (!updateMask(session, false)) void rebindMask(session)
      return true
    }
    if (entry?.ready) fold.writes = entry.writes
    if (fold.useFold !== false) await settleFoldFocus(session, questionId)
    if (active === session && !updateMask(session)) void rebindMask(session)
  }
  return true
}

export function revealSameMapQuestion(questionNoteId: string): boolean {
  const session = active
  if (!session || session.kind !== "masked" || !session.questionIds.has(questionNoteId)) return false
  session.revealedQuestionIds.add(questionNoteId)
  clearMasks(session)
  if (!updateMask(session)) void rebindMask(session)
  return true
}

/**
 * 「查找答案」入口：折叠会话按本次访问暂停自动折叠，通过场景面板展开。
 * 只有拿到"答案子卡真实视图已附着"的证据才宣称揭晓并移除遮盖；只有模型字段时
 * 停下自动折叠并返回 false，由调用方沿用答案窗口（答案一定可见）。
 */
export async function revealPracticeAnswer(questionNoteId: string): Promise<boolean> {
  const session = active
  if (!session || session.kind === "focus" || !session.questionIds.has(questionNoteId)) return false
  if (session.kind === "masked") return revealSameMapQuestion(questionNoteId)
  // 只有仍是当前题、同一页、同一学习集的访问才能改变折叠状态。
  if (session.currentQuestionId !== questionNoteId) return false
  if (session.generation !== nextGeneration) return false
  const notebookId = currentNotebookId()
  if (notebookId && notebookId !== session.notebookId) return false
  const fold = foldRun(session, questionNoteId)
  if (fold.useFold === false) {
    session.revealedQuestionIds.add(questionNoteId)
    if (!updateMask(session, false)) void rebindMask(session)
    return true
  }
  if (fold.revealed) return true
  if (fold.busy) return false
  const pauseAutoFold = () => {
    // 用户要求看答案：即使没有画面证据也不再自动收起，避免把刚展开的分支又关上。
    fold.revealed = true
    session.revealedQuestionIds.add(questionNoteId)
  }
  if (readBranchFolded(questionNoteId) === false) {
    const shown = foldConfirmation(questionNoteId, false).state === "confirmed"
    pauseAutoFold()
    if (!shown) logFoldEvent("reveal.unverified", `noteid=${questionNoteId} ${describeVisibility(foldVisibility(questionNoteId))}`)
    else clearMasks(session)
    return shown
  }
  fold.busy = true
  try {
    const outcome = await writeBranchFolded({
      owner: session.owner, notebookId: session.notebookId, noteId: questionNoteId, folded: false, reason: "reveal",
      isCurrent: () => active === session && session.generation === nextGeneration && session.currentQuestionId === questionNoteId
    })
    const shown = outcome.status === "confirmed" || outcome.status === "unchanged"
    if (shown) {
      pauseAutoFold()
      clearMasks(session)
      return true
    }
    // 字段已展开但没有画面证据，或展开失败：停止自动折叠，交给答案窗口。
    if (readBranchFolded(questionNoteId) === false) pauseAutoFold()
    logFoldEvent("reveal.fallback", `noteid=${questionNoteId} status=${outcome.status} ${visibilityDetail(questionNoteId, outcome)}`)
    return false
  } finally {
    fold.busy = false
  }
}

export function stopSameMapPractice(): void {
  const session = active
  active = undefined
  nextGeneration++
  if (session && session.kind !== "focus") clearMasks(session)
}

type FoldEntryPlan =
  | { ready: true; capability: true; writes: number }
  | { ready: false; capability: boolean; reason?: string }

interface FoldSessionOutcome {
  started: boolean
  hard?: boolean
  result: {
    started: boolean; reason?: string; answerCount?: number; maskAnswers?: boolean
    foldFirst?: boolean
  }
}

/** 焦点前已收起分支；定位后读回，确认收起才按折叠会话运行。 */
async function startFoldSession(
  notebookId: string,
  selected: Set<string>,
  firstQuestionId: string,
  options: { alreadyFocused?: boolean; owner?: any; rootNodeId?: string },
  initialWrites: number,
  isCurrent: () => boolean
): Promise<FoldSessionOutcome> {
  if (!options.alreadyFocused && await focusNoteInMindMapFocusMode(firstQuestionId) !== "focused") {
    return { started: false, hard: true, result: { started: false, reason: "无法定位并聚焦队列第一道题" } }
  }
  if (!isCurrent()) {
    return { started: false, hard: true, result: { started: false, reason: "做题模式已结束" } }
  }
  const focusedNotebookId = currentNotebookId()
  if (focusedNotebookId && focusedNotebookId !== notebookId) {
    return { started: false, hard: true, result: { started: false, reason: "学习集已切换，请重新开始做题" } }
  }
  let appearance: MaskAppearance | undefined
  try { appearance = maskAppearance() } catch { appearance = undefined }
  if (!appearance) {
    // 没有可靠的兜底遮盖时不用折叠状态承诺保护。
    hintFoldFallback(options.owner, "无法建立答案遮盖", true)
    return { started: false, result: { started: false } }
  }
  const session: PracticeSession = {
    kind: "fold", owner: options.owner, rootNodeId: options.rootNodeId, notebookId: focusedNotebookId || notebookId,
    questionIds: selected, revealedQuestionIds: new Set(), canvas: undefined, calibration: undefined,
    masks: new Map(), appearance, rebinding: false, generation: ++nextGeneration, currentQuestionId: firstQuestionId,
    fold: {
      questionId: firstQuestionId, revealed: false, busy: false, writes: initialWrites, useFold: true
    }
  }
  active = session
  const settled = await settleFoldFocus(session, firstQuestionId)
  if (active !== session) return { started: false, hard: true, result: { started: false, reason: "做题模式已结束" } }
  if (settled) {
    if (!updateMask(session)) void rebindMask(session)
    schedule(session)
    return {
      started: true,
      result: {
        started: true, answerCount: directChildIds(firstQuestionId).length, maskAnswers: true,
        foldFirst: true
      }
    }
  }
  const blocked = session.fold?.blocked || "定位后未能收起题卡分支"
  stopSameMapPractice()
  hintFoldFallback(options.owner, blocked, true)
  return { started: false, result: { started: false } }
}

export async function startSameMapPractice(notebookId: string, questionIds: Iterable<string>, options: { alreadyFocused?: boolean; maskAnswers?: boolean; owner?: any; rootNodeId?: string; foldAttempted?: boolean } = {}): Promise<{ started: boolean; reason?: string; answerCount?: number; maskAnswers?: boolean; foldFirst?: boolean }> {
  stopSameMapPractice()
  const generation = nextGeneration
  const selected = new Set(Array.from(questionIds).filter(Boolean))
  if (!selected.size) return { started: false, reason: "请先选择刷题范围" }
  const map = MN.notebookController?.mindmapView
  if (!map) return { started: false, reason: "请先打开题目脑图" }
  const firstQuestionId = [...selected][0]
  const isCurrent = () => generation === nextGeneration
  if (options.maskAnswers !== false && !options.foldAttempted) {
    const entry = await prepareFoldEntry(notebookId, firstQuestionId, { owner: options.owner, rootNodeId: options.rootNodeId, isCurrent })
    if (!isCurrent()) return { started: false, reason: "做题模式已结束" }
    if (entry.ready) {
      const folded = await startFoldSession(notebookId, selected, firstQuestionId, options, entry.writes, isCurrent)
      if (folded.started || folded.hard) return folded.result
      // 无法确认收起或无法建立兜底遮盖：同一入口改走遮盖流程，不留下无保护的会话。
      return startSameMapPractice(notebookId, questionIds, { ...options, foldAttempted: true })
    }
    if (entry.reason) hintFoldFallback(options.owner, entry.reason, entry.capability)
  }
  if (!options.alreadyFocused && await focusNoteInMindMapFocusMode(firstQuestionId) !== "focused") {
    return { started: false, reason: "无法定位并聚焦队列第一道题" }
  }
  if (generation !== nextGeneration) return { started: false, reason: "做题模式已结束" }
  const focusedNotebookId = currentNotebookId()
  if (focusedNotebookId && focusedNotebookId !== notebookId) return { started: false, reason: "学习集已切换，请重新开始做题" }
  if (options.maskAnswers === false) {
    active = { kind: "focus", notebookId, questionIds: selected, generation: ++nextGeneration, currentQuestionId: firstQuestionId }
    return { started: true, answerCount: 0, maskAnswers: false }
  }
  let card: { id: string; view: any; map: any } | undefined
  try { card = await calibrationCard(MN.notebookController?.mindmapView, new Set([firstQuestionId]), () => generation === nextGeneration &&
    (!currentNotebookId() || currentNotebookId() === notebookId)) }
  catch { return { started: false, reason: "无法自动选中题目卡片以定位遮盖" } }
  if (!card) {
    return { started: false, reason: "无法定位当前脑图卡片的遮盖位置" }
  }
  if (generation !== nextGeneration) return { started: false, reason: "做题模式已结束" }
  const calibratedNotebookId = currentNotebookId()
  if (calibratedNotebookId && calibratedNotebookId !== notebookId) return { started: false, reason: "学习集已切换，请重新开始做题" }
  const currentMap = card.map
  const nodes = Array.from(currentMap.mindmapNodes ?? []) as any[]
  const currentAnswerCount = answerFrames(currentMap, selected).size
  if (!currentAnswerCount) return { started: false, reason: "所选题目没有直接子卡片答案" }
  const anchorId = card.id
  const node = nodes.find(item => noteId(item?.note) === anchorId)
  const frame = modelFrame(node)
  if (!frame) return { started: false, reason: "无法读取定位卡片的脑图位置" }
  const placement = canvasCalibration(card.view, currentMap, frame)
  if (!placement?.canvas?.superview) return { started: false, reason: "无法定位 MindMapCanvas 或图层接口不可用，未启动答案遮盖" }
  let appearance: MaskAppearance
  try { appearance = maskAppearance() }
  catch (error) { return { started: false, reason: error instanceof Error ? error.message : "自定义遮盖图片加载失败" } }
  const session: PracticeSession = {
    kind: "masked", owner: options.owner, rootNodeId: options.rootNodeId, notebookId: currentNotebookId() || notebookId,
    questionIds: selected, revealedQuestionIds: new Set(), canvas: placement.canvas,
    calibration: placement.calibration, masks: new Map(), appearance, generation: ++nextGeneration, rebinding: false,
    currentQuestionId: firstQuestionId
  }
  active = session
  try {
    if (!updateMask(session)) {
      stopSameMapPractice()
      return { started: false, reason: "未能在答案卡片上放置遮盖" }
    }
  } catch {
    stopSameMapPractice()
    return { started: false, reason: "放置答案遮盖失败" }
  }
  if (active === session) schedule(session)
  return { started: active === session, answerCount: currentAnswerCount, maskAnswers: true, foldFirst: false }
}
