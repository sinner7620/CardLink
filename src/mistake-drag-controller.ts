import { MN } from "marginnote"
import { presentError } from "./error-messages"
import { captureDiagnosticError, recordRuntimeState } from "./note-navigation"
import { nativeViewClass } from "./same-map-practice"
import { UI_COLORS } from "./ui-tokens"
import { setWindowFrame } from "./window-opacity"
import {
  resolveMistakeDragSource, resolveMistakeDragTarget, writeMistakeDragLink,
  type MistakeDragPoint as Point, type MistakeDragRect as Rect, type MistakeHoverGeometry,
} from "./mistake-card-link"

interface Arm extends Point {
  id: string
  recordId: string
  startedAt: number
  width: number
  height: number
  reducedMotion: boolean
}

type Reply = { status: string; message?: string; noteIds?: string[] }
type Destination = ReturnType<typeof resolveMistakeDragTarget>
type Timer = { invalidate(): void }
type Press = { origin: Point; point: Point; beganAt: number; webView: any }
type DragVisual = UIView & { removeFromSuperview(): void }
type Overlay = { card: DragVisual; ring: DragVisual }
type Pending = {
  arm: Arm
  webView?: any
  complete: (result: Reply) => void
  active: () => boolean
  timeout?: Timer
  source?: ReturnType<typeof resolveMistakeDragSource>
  notebookId?: string
  lastHoverAt?: number
  hover: MistakeHoverGeometry
  matchAttempt?: string
}
interface Tracker {
  window: any
  delegate: any
  gesture: any
  press?: Press
  pending?: Pending
  overlay?: Overlay
  cancelledArmId?: string
}

const trackers = new WeakMap<object, Tracker>()
const MATCH_WAIT_MS = 1000
const MATCH_TIME_TOLERANCE_MS = 500
const MATCH_DISTANCE = 40
const WEB_HOLD_MS = 340
const HOLD_SECONDS = 0.35
const HOVER_INTERVAL = 80
const CARD_WIDTH = 200
const CARD_HEIGHT = 48
let GestureDelegate: any

function reportError(error: unknown): Reply {
  captureDiagnosticError(error, "错题拖放", "原生拖放")
  return { status: "error", message: error instanceof Error && !("code" in error)
    ? error.message : presentError(error).message }
}

function originWebView(window: any, point: Point): any {
  for (let view = window.hitTestWithEvent(point, null); view && view !== window; view = view.superview) {
    if (/\b(?:WKWebView|UIWebView)\b/.test(nativeViewClass(view))) return view
  }
}

function isWithinView(view: any, ancestor: any, window: any): boolean {
  for (; view && view !== window; view = view.superview) {
    if (view === ancestor) return true
  }
  return false
}

function dragLog(event: string, detail: string): void {
  recordRuntimeState("错题拖放", `nativeGesture.${event}`, detail)
}

function matchPress(tracker: Tracker, pending: Pending, press: Press): { accepted: boolean; detail: string } {
  const { arm } = pending
  const reference = pending.webView || press.webView
  const panel = pending.webView ? "classic" : "scene"
  const pointSource = pending.webView ? "requestWebView" : "hitWebView"
  const timeDeltaMs = press.beganAt - arm.startedAt - HOLD_SECONDS * 1000
  let dx = NaN
  let dy = NaN
  let reason = "matched"
  if (!isWithinView(press.webView, reference, tracker.window)) {
    reason = "differentWebView"
  } else {
    const bounds: Rect = reference.bounds
    const point: Point = tracker.window.convertPointToView(press.origin, reference)
    if (usableFrame(bounds) && usablePoint(point)) {
      dx = point.x - (bounds.x + arm.x * bounds.width / arm.width)
      dy = point.y - (bounds.y + arm.y * bounds.height / arm.height)
      if (Math.abs(timeDeltaMs) > MATCH_TIME_TOLERANCE_MS) reason = "timeMismatch"
      else if (Math.hypot(dx, dy) > MATCH_DISTANCE) reason = "coordinateMismatch"
    } else {
      reason = "invalidGeometry"
    }
  }
  return {
    accepted: reason === "matched",
    detail: `panel=${panel}; pointSource=${pointSource}; timeDeltaMs=${timeDeltaMs}; dx=${dx}; dy=${dy}; reason=${reason}`,
  }
}

function floatingFrame(point: Point): Rect {
  return { x: point.x - 24, y: point.y - CARD_HEIGHT - 12, width: CARD_WIDTH, height: CARD_HEIGHT }
}

function removeOverlay(tracker: Tracker): void {
  const overlay = tracker.overlay
  tracker.overlay = undefined
  overlay?.ring.removeFromSuperview()
  overlay?.card.removeFromSuperview()
}

function createOverlay(tracker: Tracker, point: Point, title: string): void {
  removeOverlay(tracker)
  const frame = floatingFrame(point)
  const card = new UIView(frame) as DragVisual
  const ring = new UIView(frame) as DragVisual
  tracker.overlay = { card, ring }
  for (const view of [card, ring]) {
    const visual = view as any
    visual.userInteractionEnabled = false
    visual.accessibilityElementsHidden = true
    view.layer.borderColor = UIColor.colorWithHexString(UI_COLORS.accent)
  }
  card.backgroundColor = UIColor.colorWithHexString(UI_COLORS.surface)
  card.layer.cornerRadius = 12
  card.layer.borderWidth = 1
  const layer = card.layer as any
  layer.shadowColor = UIColor.blackColor()
  layer.shadowOpacity = 0.22
  layer.shadowOffset = { width: 0, height: 4 }
  layer.shadowRadius = 10
  // The host uses the UIView frame initializer for labels in the classic panel too.
  const NativeLabel = UILabel as unknown as new (frame: Rect) => UILabel
  const label = new NativeLabel({ x: 12, y: 8, width: CARD_WIDTH - 24, height: CARD_HEIGHT - 16 })
  label.text = title
  label.textColor = UIColor.blackColor()
  label.autoresizingMask = (1 << 1) | (1 << 4)
  label.numberOfLines = 2
  label.lineBreakMode = 4
  card.addSubview(label)
  ring.backgroundColor = UIColor.colorWithHexString(UI_COLORS.accent).colorWithAlphaComponent(0.08)
  ring.layer.cornerRadius = 8
  ring.layer.borderWidth = 2
  ring.hidden = true
  tracker.window.addSubview(ring)
  tracker.window.addSubview(card)
}

function usableFrame(frame?: Rect): frame is Rect {
  return !!frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
    && frame.width > 0 && frame.height > 0
}

function usablePoint(point?: Point): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function settleOverlay(tracker: Tracker, point: Point, destination: Destination, reduced: boolean): void {
  const overlay = tracker.overlay
  if (!overlay) return
  const animate = (UIView as any).animateWithDurationAnimationsCompletion
  if (reduced || typeof animate !== "function") return removeOverlay(tracker)
  const frame = destination?.frame
  const finishFrame = usableFrame(frame) ? {
    x: frame.x + frame.width / 2 - 8, y: frame.y + frame.height / 2 - 4, width: 16, height: 8,
  } : floatingFrame(point)
  try {
    animate.call(UIView, 0.22, () => {
      overlay.card.frame = finishFrame
      ;(overlay.card as any).alpha = 0
      ;(overlay.ring as any).alpha = 0
    }, () => { if (tracker.overlay === overlay) removeOverlay(tracker) })
  } catch { removeOverlay(tracker) }
}

function finish(tracker: Tracker, result: Reply, destination?: Destination): void {
  const pending = tracker.pending
  const press = tracker.press
  tracker.pending = undefined
  pending?.timeout?.invalidate()
  if (press && pending?.source) {
    settleOverlay(tracker, press.origin, destination, pending.arm.reducedMotion)
  } else {
    removeOverlay(tracker)
  }
  pending?.complete(result)
}

function bindPress(tracker: Tracker): void {
  const { press, pending } = tracker
  if (!press || !pending || pending.source) return
  try {
    const match = matchPress(tracker, pending, press)
    pending.matchAttempt = match.detail
    dragLog(match.accepted ? "accepted" : "rejected", match.detail)
    if (!match.accepted) return
    pending.source = resolveMistakeDragSource(pending.arm.recordId)
    pending.notebookId = MN.app.studyController(tracker.window)?.notebookController?.notebookId
    pending.timeout?.invalidate()
    pending.timeout = NSTimer.scheduledTimerWithTimeInterval(28, false, () =>
      finish(tracker, { status: "cancelled" }))
    try {
      createOverlay(tracker, press.point, pending.source.title)
    } catch (error) {
      removeOverlay(tracker)
      captureDiagnosticError(error, "错题拖放", "创建拖动缩略卡")
    }
  } catch (error) {
    finish(tracker, reportError(error))
  }
}

function updateOverlay(tracker: Tracker, pending: Pending, point: Point): void {
  const overlay = tracker.overlay
  if (!overlay) return
  setWindowFrame(overlay.card, floatingFrame(point))
  const now = Date.now()
  if (now - (pending.lastHoverAt ?? 0) < HOVER_INTERVAL) return
  pending.lastHoverAt = now
  let frame: Rect | undefined
  try {
    const target = resolveMistakeDragTarget(tracker.window, point, pending.hover)
    if (target && target.note.noteId !== pending.source?.note.noteId && target.notebookId === pending.notebookId) {
      frame = target.frame
    }
  } catch { /* An ambiguous hover is deliberately unhighlighted. */ }
  overlay.ring.hidden = !usableFrame(frame)
  if (usableFrame(frame)) setWindowFrame(overlay.ring, frame)
}

function trackGesture(tracker: Tracker, sender: any): void {
  const point: Point = sender.locationInView(tracker.window)
  if (!usablePoint(point)) {
    dragLog("rejected", `pointSource=window; state=${sender.state}; reason=invalidNativePoint`)
    if (tracker.press) finish(tracker, { status: tracker.pending?.source ? "cancelled" : "unavailable" })
    tracker.press = undefined
    return
  }
  if (sender.state === 1) {
    const webView = originWebView(tracker.window, point)
    dragLog("began", `hitWebView=${!!webView}; pending=${!!tracker.pending}`)
    if (!webView) return
    tracker.press = { origin: point, point, webView, beganAt: Date.now() }
    bindPress(tracker)
    return
  }
  const { press, pending } = tracker
  if (!press) return
  press.point = point
  if (sender.state === 2) {
    if (pending?.source) updateOverlay(tracker, pending, point)
    return
  }
  if (pending?.source) {
    if (sender.state !== 3 || !pending.active() || Math.hypot(point.x - press.origin.x, point.y - press.origin.y) < 8) {
      finish(tracker, { status: "cancelled" })
    } else {
      try {
        const target = resolveMistakeDragTarget(tracker.window, point)
        if (!target || !pending.notebookId || target.notebookId !== pending.notebookId) {
          finish(tracker, { status: "miss" })
        } else {
          const source = resolveMistakeDragSource(pending.arm.recordId)
          const result = writeMistakeDragLink(target, source)
          finish(tracker, result, ["linked", "exists"].includes(result.status) ? target : undefined)
        }
      } catch (error) {
        finish(tracker, reportError(error))
      }
    }
  } else if (pending) {
    finish(tracker, { status: "unavailable" })
  }
  tracker.press = undefined
}

export function enableMistakeDrag(owner: any): void {
  if (!owner?.window || trackers.has(owner)) return
  const window = owner.window
  if (typeof window.hitTestWithEvent !== "function" || typeof window.convertPointToView !== "function") return
  try {
    GestureDelegate ||= JSB.defineClass("CardLinkMistakeDragDelegate : UIViewController <UIGestureRecognizerDelegate>", {
      gestureRecognizerShouldBegin(sender: any) {
        const tracker: Tracker = self.cardLinkMistakeDrag
        if (!tracker) return false
        const point: Point = sender.locationInView(tracker.window)
        return usablePoint(point) && !!originWebView(tracker.window, point)
      },
      gestureRecognizerShouldRecognizeSimultaneouslyWithGestureRecognizer() { return true },
      trackMistakeDrag(sender: any) {
        const tracker: Tracker = self.cardLinkMistakeDrag
        if (!tracker) return
        try { trackGesture(tracker, sender) }
        catch (error) {
          finish(tracker, reportError(error))
          tracker.press = undefined
        }
      },
    }, {})
    const delegate = GestureDelegate.new()
    const gesture: any = new UILongPressGestureRecognizer(delegate, "trackMistakeDrag:")
    const tracker = { window, delegate, gesture }
    delegate.cardLinkMistakeDrag = tracker
    gesture.minimumPressDuration = HOLD_SECONDS
    gesture.allowableMovement = 12
    gesture.cancelsTouchesInView = false
    gesture.delaysTouchesBegan = false
    gesture.delaysTouchesEnded = false
    // UITouchType: direct, indirect, pencil, indirectPointer.
    try { gesture.allowedTouchTypes = [0, 1, 2, 3] } catch { /* Legacy UIKit uses its default set. */ }
    gesture.delegate = delegate
    window.addGestureRecognizer(gesture)
    trackers.set(owner, tracker)
    dragLog("registered", "pointSource=window")
  } catch (error) {
    captureDiagnosticError(error, "错题拖放", "注册窗口手势")
  }
}

export function armMistakeDrag(owner: any, webView: any, arm: Arm, active: () => boolean): Promise<Reply> | Reply {
  const tracker = trackers.get(owner)
  if (!tracker) return { status: "unavailable" }
  const now = Date.now()
  if (!arm || typeof arm.id !== "string" || typeof arm.recordId !== "string" ||
    ![arm.x, arm.y, arm.width, arm.height, arm.startedAt].every(Number.isFinite) ||
    arm.width <= 0 || arm.height <= 0 || arm.x < 0 || arm.y < 0 || arm.x >= arm.width || arm.y >= arm.height ||
    arm.startedAt > now || now - arm.startedAt > WEB_HOLD_MS + MATCH_WAIT_MS) return { status: "unavailable" }
  if (tracker.pending || tracker.cancelledArmId === arm.id) return { status: "cancelled" }
  return new Promise(complete => {
    const pending: Pending = { arm, webView, complete, active, hover: {} }
    tracker.pending = pending
    pending.timeout = NSTimer.scheduledTimerWithTimeInterval(MATCH_WAIT_MS / 1000, false, () => {
      if (tracker.pending !== pending) return
      dragLog("timeout", pending.matchAttempt ||
        `panel=${webView ? "classic" : "scene"}; pointSource=window; reason=noNativePress`)
      finish(tracker, { status: "unavailable" })
    })
    bindPress(tracker)
  })
}

export function cancelMistakeDrag(owner: any, id?: string): void {
  const tracker = trackers.get(owner)
  if (!tracker) return
  if (id !== undefined) {
    tracker.cancelledArmId = id
    if (tracker.pending?.arm.id !== id) return
  }
  tracker.press = undefined
  finish(tracker, { status: "cancelled" })
}

export function disableMistakeDrag(owner: any): void {
  const tracker = trackers.get(owner)
  if (!tracker) return
  cancelMistakeDrag(owner)
  trackers.delete(owner)
  tracker.delegate.cardLinkMistakeDrag = undefined
  tracker.gesture.enabled = false
  tracker.window.removeGestureRecognizer(tracker.gesture)
}
