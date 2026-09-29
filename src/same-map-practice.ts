import { delay, MN, showHUD, type UIImage } from "marginnote"
import { decodeBase64Ascii } from "./base64"
import { loadMatcherSettings } from "./settings"
import { focusNoteInMindMapFocusMode, locateNoteInCurrentMindMap } from "./note-navigation"

type Rect = { x: number; y: number; width: number; height: number }
type Calibration = { sx: number; sy: number; tx: number; ty: number }
type MaskAppearance = { color: string; image?: UIImage }

interface PracticeSession {
  notebookId: string
  questionIds: Set<string>
  revealedQuestionIds: Set<string>
  canvas: any
  calibration: Calibration
  masks: Map<string, UIView>
  appearance: MaskAppearance
  generation: number
  rebinding: boolean
}

let active: PracticeSession | undefined
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

async function calibrationCard(map: any, questionIds: Set<string>): Promise<{ id: string; view: any; map: any } | undefined> {
  const current = selectedCardView(map)
  const firstQuestionId = [...questionIds][0]
  if (current?.id === firstQuestionId && current.view?.superview &&
    (Array.from(map?.mindmapNodes ?? []) as any[]).some(node => noteId(node?.note) === current.id)) {
    return { ...current, map }
  }
  if (!firstQuestionId || typeof MNUtil?.selectNotesInMindmap !== "function") return
  for (let attempt = 0; attempt < 10; attempt++) {
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

function canvasCalibration(cardView: any, map: any, model: Rect): { canvas: any; calibration: Calibration } | undefined {
  const cardBounds = rectOf(cardView, "bounds")
  if (!cardBounds) return
  let child = cardView
  let converted = cardBounds
  const candidates: Array<{ canvas: any; rect: Rect; score: number }> = []
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
    const parentBounds = rectOf(parent, "bounds")
    let score = Math.abs(converted.x - model.x) / Math.max(24, model.width) +
      Math.abs(converted.y - model.y) / Math.max(24, model.height) +
      Math.abs(converted.width - model.width) / Math.max(24, model.width) +
      Math.abs(converted.height - model.height) / Math.max(24, model.height)
    if (parentBounds) {
      if (parentBounds.width < cardBounds.width * 1.35 && parentBounds.height < cardBounds.height * 1.35) score += 4
      else if (parentBounds.width < cardBounds.width * 2 && parentBounds.height < cardBounds.height * 2) score += 1.2
    }
    if (Array.from(parent.subviews ?? []).length <= 1) score += 0.7
    if (level === 1) score += 0.9
    else if (level === 2) score += 0.3
    candidates.push({ canvas: parent, rect: { ...converted }, score })
    if (parent === map) break
    child = parent
  }
  candidates.sort((a, b) => a.score - b.score)
  // The reference add-on verified candidate #2 above the handwriting layer.
  const candidate = candidates[1] ?? candidates[0]
  if (!candidate) return
  const sx = candidate.rect.width / model.width, sy = candidate.rect.height / model.height
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return
  return {
    canvas: candidate.canvas,
    calibration: { sx, sy, tx: candidate.rect.x - model.x * sx, ty: candidate.rect.y - model.y * sy }
  }
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

function makeMask(appearance: MaskAppearance): UIView {
  const mask = new UIView({ x: 0, y: 0, width: 1, height: 1 })
  mask.backgroundColor = UIColor.colorWithHexString(appearance.color).colorWithAlphaComponent(0.99)
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
  return mask
}

function clearMasks(session: PracticeSession): void {
  for (const mask of session.masks.values()) {
    try { (mask as any).removeFromSuperview() } catch { /* detached canvas */ }
  }
  session.masks.clear()
}

function canvasInMindMap(canvas: any, map: any): boolean {
  for (let view = canvas, level = 0; view && level <= 18; view = view.superview, level++) {
    if (view === map) return true
  }
  return false
}

function updateMask(session: PracticeSession): boolean {
  const notebookId = currentNotebookId()
  if (active !== session || !session.canvas?.superview || (notebookId && notebookId !== session.notebookId)) return false
  const map = MN.notebookController?.mindmapView
  if (!map) return true
  if (!canvasInMindMap(session.canvas, map)) return false
  const wanted = answerFrames(map, new Set([...session.questionIds].filter(id => !session.revealedQuestionIds.has(id))))
  if (!wanted.size && session.questionIds.size > session.revealedQuestionIds.size) return true
  for (const [id, mask] of session.masks) {
    if (!wanted.has(id)) {
      ;(mask as any).removeFromSuperview()
      session.masks.delete(id)
    }
  }
  let covered = 0
  for (const [id, frame] of wanted) {
    const { sx, sy, tx, ty } = session.calibration
    const target = { x: tx + frame.x * sx, y: ty + frame.y * sy, width: frame.width * sx, height: frame.height * sy }
    if (target.width <= 4 || target.height <= 4) continue
    let mask = session.masks.get(id)
    if (!mask) {
      mask = makeMask(session.appearance)
      session.masks.set(id, mask)
    }
    mask.frame = target
    const subviews = Array.from((mask as any).subviews ?? []) as any[]
    if (subviews.length > 1) subviews[0].frame = { x: 0, y: 0, width: target.width, height: target.height }
    const label = subviews[subviews.length - 1]
    if (label) label.frame = { x: 6, y: Math.max(0, target.height / 2 - 19), width: Math.max(0, target.width - 12), height: 38 }
    session.canvas.addSubview(mask)
    covered++
  }
  return wanted.size === 0 || covered > 0
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
    const card = await calibrationCard(map, new Set([calibrationId]))
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
      if (!updateMask(session)) {
        void rebindMask(session)
      }
    } catch {
      void rebindMask(session)
    }
    schedule(session)
  })
}

export function sameMapPracticeActive(): boolean {
  return !!active
}

export function sameMapPracticeQuestionIds(): string[] {
  return active ? [...active.questionIds] : []
}

export async function navigateSameMapPractice(questionId: string): Promise<boolean> {
  const session = active
  if (!session?.questionIds.has(questionId)) return false
  if (!await locateNoteInCurrentMindMap(questionId)) {
    showHUD("无法定位当前题目卡片", 3)
    return false
  }
  if (active !== session) return false
  return true
}

export function revealSameMapQuestion(questionNoteId: string): boolean {
  const session = active
  if (!session || !session.questionIds.has(questionNoteId)) return false
  session.revealedQuestionIds.add(questionNoteId)
  clearMasks(session)
  if (!updateMask(session)) void rebindMask(session)
  return true
}

export function stopSameMapPractice(): void {
  const session = active
  active = undefined
  nextGeneration++
  if (!session) return
  clearMasks(session)
}

export async function startSameMapPractice(notebookId: string, questionIds: Iterable<string>): Promise<{ started: boolean; reason?: string; answerCount?: number }> {
  stopSameMapPractice()
  const selected = new Set(Array.from(questionIds).filter(Boolean))
  if (!selected.size) return { started: false, reason: "请先选择刷题范围" }
  const map = MN.notebookController?.mindmapView
  if (!map) return { started: false, reason: "请先打开题目脑图" }
  const answerCount = answerFrames(map, selected).size
  if (!answerCount) return { started: false, reason: "所选题目没有直接子卡片答案" }
  const firstQuestionId = [...selected][0]
  if (await focusNoteInMindMapFocusMode(firstQuestionId) !== "focused") {
    return { started: false, reason: "无法定位并聚焦队列第一道题" }
  }
  let card: { id: string; view: any; map: any } | undefined
  try { card = await calibrationCard(MN.notebookController?.mindmapView, new Set([firstQuestionId])) }
  catch { return { started: false, reason: "无法自动选中题目卡片以定位遮盖" } }
  if (!card) {
    return { started: false, reason: "无法定位当前脑图卡片的遮盖位置" }
  }
  const currentMap = card.map
  const nodes = Array.from(currentMap.mindmapNodes ?? []) as any[]
  const currentAnswerCount = answerFrames(currentMap, selected).size
  if (!currentAnswerCount) return { started: false, reason: "当前脑图中未找到所选题目的直接子卡片" }
  const anchorId = card.id
  const node = nodes.find(item => noteId(item?.note) === anchorId)
  const frame = modelFrame(node)
  if (!frame) return { started: false, reason: "无法读取定位卡片的脑图位置" }
  const placement = canvasCalibration(card.view, currentMap, frame)
  if (!placement?.canvas?.superview) return { started: false, reason: "无法建立脑图遮盖坐标" }
  let appearance: MaskAppearance
  try { appearance = maskAppearance() }
  catch (error) { return { started: false, reason: error instanceof Error ? error.message : "自定义遮盖图片加载失败" } }
  const session: PracticeSession = {
    notebookId: currentNotebookId() || notebookId, questionIds: selected, revealedQuestionIds: new Set(), canvas: placement.canvas,
    calibration: placement.calibration, masks: new Map(), appearance, generation: ++nextGeneration, rebinding: false
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
  return { started: active === session, answerCount: currentAnswerCount }
}
