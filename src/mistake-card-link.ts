import { MN, type MbBookNote, type MindMapNode } from "marginnote"
import { CardLinkError } from "./errors"
import { loadMistakeState } from "./mistake-store"
import { commentNoteReferenceId } from "./note-link"
import { recordRuntimeState } from "./note-navigation"
import { canvasCalibration, nativeViewClass } from "./same-map-practice"
import { loadMatcherSettings } from "./settings"

export type MistakeDragPoint = { x: number; y: number }
export type MistakeDragRect = MistakeDragPoint & { width: number; height: number }
type Point = MistakeDragPoint
type Rect = MistakeDragRect
type Calibration = NonNullable<ReturnType<typeof canvasCalibration>>["calibration"]
type Drop = Point & { recordId: string; width: number; height: number }
type NodeGeometry = { node: MindMapNode; noteId: string; frame: Rect }
export type MistakeHoverGeometry = { map?: unknown; nodes?: NodeGeometry[] }

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width &&
    point.y >= rect.y && point.y < rect.y + rect.height
}

function withoutEnclosingAncestors(candidates: NodeGeometry[]): NodeGeometry[] {
  const frames = new Map(candidates.map(candidate => [candidate.noteId, candidate.frame]))
  const enclosing = new Set<string>()
  for (const { node, noteId, frame } of candidates) {
    const ancestors = new Set<string>([noteId])
    for (let parent = node.parentNode; parent?.note?.noteId; parent = parent.parentNode) {
      if (ancestors.has(parent.note.noteId)) break
      ancestors.add(parent.note.noteId)
    }
    const modelAncestors = new Set<string>([noteId])
    for (let parent = node.note.parentNote; parent?.noteId; parent = parent.parentNote) {
      if (modelAncestors.has(parent.noteId)) break
      modelAncestors.add(parent.noteId)
      ancestors.add(parent.noteId)
    }
    ancestors.delete(noteId)
    for (const parentId of ancestors) {
      const outer = frames.get(parentId)
      if (outer && outer.x <= frame.x && outer.y <= frame.y &&
        outer.x + outer.width >= frame.x + frame.width &&
        outer.y + outer.height >= frame.y + frame.height &&
        (outer.width > frame.width || outer.height > frame.height)) {
        enclosing.add(parentId)
      }
    }
  }
  return candidates.filter(candidate => !enclosing.has(candidate.noteId))
}

function hitCanvas(window: any, map: any, point: Point) {
  // UIKit resolves clipping and stacking, including panels covering the map.
  const hitView = window.hitTestWithEvent(point, null)
  let canvas
  for (let view = hitView; view && view !== window; view = view.superview) {
    if (view === map) return { canvas: canvas ?? map, hitView }
    if (!canvas && nativeViewClass(view).includes("MindMapCanvas")) canvas = view
  }
}

function hitPath(hitView: any, canvas: any): any[] {
  const views = []
  for (let view = hitView; view && view !== canvas; view = view.superview) {
    views.push(view)
  }
  return views
}

function hitCardNoteId(views: any[], selections: any[]): string | undefined {
  for (const view of views) {
    const selected = selections.find(entry => entry?.view === view)
    const node = selected ? selected.note : view.note
    const id = node?.note?.noteId ?? node?.noteId
    if (typeof id === "string" && id) return id
  }
}

function rectInCanvas(frame: Rect, transform?: Calibration): Rect {
  if (!transform) return frame
  const { sx, sy, tx, ty } = transform
  return { x: frame.x * sx + tx, y: frame.y * sy + ty, width: frame.width * sx, height: frame.height * sy }
}

function viewRectInCanvas(view: any, canvas: any): Rect | undefined {
  try {
    const rect: Rect | undefined = view.bounds && view.convertRectToView?.(view.bounds, canvas)
    if (rect && rect.width > 0 && rect.height > 0 &&
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return rect
  } catch { /* Some JSB views do not expose coordinate conversion. */ }
}

function sameRect(a: Rect, b: Rect): boolean {
  const tolerance = 1
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.x + a.width - b.x - b.width) <= tolerance &&
    Math.abs(a.y + a.height - b.y - b.height) <= tolerance
}

function logAmbiguousDrop(
  canvas: any, canvasPoint: Point, transform: Calibration | undefined,
  hits: NodeGeometry[], views: Array<{ view: any; rect?: Rect }>, hitNoteId?: string,
) {
  if (!loadMatcherSettings().debugModeEnabled) return
  const rectText = (rect?: Rect) => rect
    ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10).join(",") : "?"
  const viewName = (view: any) => nativeViewClass(view).match(/^<?([\w.$]+)/)?.[1] ?? "?"
  const viewText = views.slice(0, 8).map(({ view, rect }) => `${viewName(view)}[${rectText(rect)}]`).join(" > ")
  const nodeText = hits.slice(0, 8).map(({ node, frame }) =>
    `[${rectText(rectInCanvas(frame, transform))}] mode=${node.note.groupMode ?? "?"} z=${node.note.zLevel ?? "?"}`).join(" | ")
  recordRuntimeState("错题拖放", "target.ambiguous",
    `point=${canvasPoint.x},${canvasPoint.y} calibrated=${!!transform} canvas=${viewName(canvas)} identity=${!!hitNoteId} views=${viewText || "(canvas only)"} hits=${hits.length} ${nodeText}`)
}

function nodeGeometry(map: any): NodeGeometry[] {
  const result: NodeGeometry[] = []
  for (const node of Array.from(map.mindmapNodes ?? []) as MindMapNode[]) {
    const noteId = node.note?.noteId, frame = node.frame
    if (noteId && frame) result.push({ node, noteId, frame })
  }
  return result
}

function targetAtPoint(window: any, map: any, point: Point, hover?: MistakeHoverGeometry) {
  const hit = hitCanvas(window, map, point)
  if (!hit) return
  const { canvas, hitView } = hit
  const canvasPoint: Point = window.convertPointToView(point, canvas)
  const nodes = hover?.map === map && hover?.nodes ? hover.nodes : nodeGeometry(map)
  if (hover) { hover.map = map; hover.nodes = nodes }
  let modelPoint = canvasPoint
  // A rendered selection supplies the same model-to-canvas calibration as
  // the native practice overlays.
  const selected = map.selViewLst?.[0]
  const selectedId = selected?.note?.note?.noteId
  const selectedNode = selectedId && nodes.find(node => node.noteId === selectedId)
  const placement = selectedNode && canvasCalibration(selected.view, map, selectedNode.frame)
  const transform = placement?.canvas === canvas ? placement?.calibration : undefined
  if (transform) {
    const { sx, sy, tx, ty } = transform
    modelPoint = { x: (canvasPoint.x - tx) / sx, y: (canvasPoint.y - ty) / sy }
  }

  const hits = nodes.filter(node => contains(node.frame, modelPoint))
  const candidates = hits.length > 1 ? withoutEnclosingAncestors(hits) : hits
  let target = candidates[0]
  if (candidates.length > 1) {
    // Use the actual UIKit hit path. The model list has no stacking guarantee.
    const path = hitPath(hitView, canvas)
    const hitNoteId = hitCardNoteId(path, Array.from(map.selViewLst ?? []))
    let frontmost = candidates.find(node => node.noteId === hitNoteId)
    if (!frontmost) {
      const views = path.map(view => ({ view, rect: viewRectInCanvas(view, canvas) }))
      if (!hitNoteId) {
        // Match the frontmost native view by all four edges when JSB omits its note.
        for (const { rect } of views) {
          if (!rect) continue
          const matches = candidates.filter(node => sameRect(rect, rectInCanvas(node.frame, transform)))
          if (!matches.length) continue
          if (matches.length === 1) frontmost = matches[0]
          break
        }
      }
      if (!frontmost) {
        if (!hover) logAmbiguousDrop(canvas, canvasPoint, transform, hits, views, hitNoteId)
        throw new Error("无法确定重叠卡片中的最上层，请拖到目标卡片的独立区域")
      }
    }
    target = frontmost
  }
  if (target) return { note: target.node.note, canvas, frame: target.frame, transform }
}

export function resolveMistakeDragTarget(window: any, point: Point, hover?: MistakeHoverGeometry) {
  const notebook = MN.app.studyController(window)?.notebookController
  const map = notebook?.mindmapView
  if (!map || typeof window.hitTestWithEvent !== "function" || typeof window.convertPointToView !== "function") {
    throw new Error("当前窗口未提供脑图拖放所需接口")
  }
  if (!contains(window.bounds, point)) return
  const target = targetAtPoint(window, map, point, hover)
  if (!target) return
  const { note, canvas, frame, transform } = target
  let windowFrame: Rect | undefined
  if (typeof canvas.convertRectToView === "function") {
    windowFrame = canvas.convertRectToView(rectInCanvas(frame, transform), window)
  }
  return { note, notebookId: notebook?.notebookId, frame: windowFrame }
}

export function resolveMistakeDragSource(recordId: string) {
  const record = loadMistakeState({ persistRecovery: false }).records[recordId]
  if (!record) throw new CardLinkError("mistakeRecordMissing")
  const note = MN.db.getNoteById(record.sourceNoteId)
  if (!note) throw new CardLinkError("sourceNoteUnavailable")
  return { note, notebookId: note.notebookId || record.sourceNotebookId, title: record.sourceTitle }
}

function hasOutgoingLink(note: MbBookNote, toId: string): boolean {
  // The aggregate link relationship does not establish which card owns the reference.
  return Array.from(note.comments ?? []).some(comment => commentNoteReferenceId(comment) === toId)
}

export function linkMistakeOnDrop(window: any, webView: any, drop: Drop) {
  if (!drop || typeof drop.recordId !== "string" ||
    ![drop.x, drop.y, drop.width, drop.height].every(Number.isFinite) || drop.width <= 0 || drop.height <= 0) {
    throw new Error("拖放位置无效，请重试")
  }
  if (typeof webView.convertPointToView !== "function") {
    throw new Error("当前窗口未提供脑图拖放所需接口")
  }
  const bounds: Rect = webView.bounds
  const point = webView.convertPointToView({
    x: bounds.x + drop.x * bounds.width / drop.width,
    y: bounds.y + drop.y * bounds.height / drop.height,
  }, window)
  const target = resolveMistakeDragTarget(window, point)
  if (!target) return { status: "miss" }
  return writeMistakeDragLink(target, resolveMistakeDragSource(drop.recordId))
}

export function writeMistakeDragLink(
  destination: NonNullable<ReturnType<typeof resolveMistakeDragTarget>>,
  dragged: ReturnType<typeof resolveMistakeDragSource>,
) {
  const { note: target, notebookId } = destination
  const { note: source } = dragged
  if (target.noteId === source.noteId) return { status: "sameNote" }
  const directions = [
    { from: target, to: source, ownerId: notebookId },
    { from: source, to: target, ownerId: dragged.notebookId },
  ]
  const missing = directions.filter(({ from, to }) => !hasOutgoingLink(from, to.noteId))
  if (!missing.length) return { status: "exists" }
  const groups = new Map<string, typeof directions>()
  for (const direction of missing) {
    const { ownerId, from } = direction
    if (!ownerId || typeof from.appendNoteLink !== "function") throw new Error("无法在两张卡片上创建原生链接")
    const group = groups.get(ownerId) || []
    group.push(direction)
    groups.set(ownerId, group)
  }
  let failure: unknown
  try {
    const undo = UndoManager.sharedInstance()
    for (const [ownerId, group] of groups) {
      let executed = false
      const write = () => {
        executed = true
        for (const { from, to } of group) {
          const current = MN.db.getNoteById(from.noteId) ?? from
          if (!hasOutgoingLink(current, to.noteId)) current.appendNoteLink(to)
        }
      }
      try {
        undo.undoGrouping("建立双向卡片链接", ownerId, write)
        // MarginNote can skip the undo closure for a study set that is not open.
        if (!executed && ownerId !== notebookId) {
          write()
          MN.db.setNotebookSyncDirty(ownerId)
        }
      } finally {
        if (executed) MN.app.refreshAfterDBChanged(ownerId)
      }
    }
  } catch (error) {
    failure = error
  }
  const unverified = directions.filter(({ from, to }) =>
    !hasOutgoingLink(MN.db.getNoteById(from.noteId) ?? from, to.noteId))
  if (!unverified.length) return { status: "linked", noteIds: [source.noteId, target.noteId] }
  if (unverified.length === 1) throw new Error("目前只确认了一个方向的链接，请再次拖拽补齐另一侧")
  throw failure || new Error("MarginNote 未确认写入双向链接，请重试")
}
