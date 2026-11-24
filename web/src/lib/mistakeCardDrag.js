const HOLD_MS = 340
const MOVE_THRESHOLD = 8

export function installMistakeCardDrag(list, { onLift, onDrop, onCancel }) {
  const document = list.ownerDocument
  const window = document.defaultView
  const mouseDown = window.PointerEvent ? "pointerdown" : "mousedown"
  const mouseMove = window.PointerEvent ? "pointermove" : "mousemove"
  const mouseUp = window.PointerEvent ? "pointerup" : "mouseup"
  let gesture
  let suppressedClick
  let sequence = 0

  function clear() {
    const current = gesture
    if (!current) return
    gesture = undefined
    window.clearTimeout(current.timer)
    delete current.row.dataset.mistakeDragActive
    if (current.row.hasPointerCapture?.(current.id)) current.row.releasePointerCapture(current.id)
  }

  function begin(event, point, touch) {
    if (gesture || !point) return
    const row = event.target.closest?.("[data-mistake-drag-record]")
    if (!row || !list.contains(row)) return
    if (touch || event.type === "pointerdown" || Date.now() > (suppressedClick?.until ?? 0)) suppressedClick = undefined
    const current = {
      row, touch, id: touch ? point.identifier : point.pointerId,
      x: point.clientX, y: point.clientY, active: false, moved: false,
      startedAt: Date.now(),
    }
    gesture = current
    current.timer = window.setTimeout(() => {
      const recordId = row.dataset.mistakeDragRecord
      if (gesture !== current || !row.isConnected || !recordId) return clear()
      current.active = true
      row.dataset.mistakeDragActive = ""
      current.dragId = `${current.startedAt}-${++sequence}`
      current.native = onLift({
        id: current.dragId, startedAt: current.startedAt, recordId,
        x: current.x, y: current.y, width: window.innerWidth, height: window.innerHeight,
        reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
      })
      if (!touch && current.id !== undefined) {
        try { row.setPointerCapture(current.id) } catch { /* The press may have ended. */ }
      }
    }, HOLD_MS)
  }

  function startTouch(event) {
    if (event.touches.length !== 1) return cancelNative()
    begin(event, event.changedTouches[0], true)
  }

  function startMouse(event) {
    if (event.button === 0 && (!event.pointerType || event.pointerType === "mouse")) begin(event, event, false)
  }

  function eventPoint(event) {
    if (gesture?.touch && event.changedTouches) {
      return Array.from(event.changedTouches).find(touch => touch.identifier === gesture.id)
    }
    if (gesture && !gesture.touch && !event.changedTouches && event.pointerId === gesture.id) return event
  }

  function move(event) {
    const point = eventPoint(event)
    if (!point) return
    const moved = Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) >= MOVE_THRESHOLD
    if (!gesture.active) {
      if (moved) clear()
      return
    }
    gesture.moved ||= moved
    event.preventDefault()
  }

  function end(event) {
    const point = eventPoint(event)
    if (!point) return
    const { row, active, moved, native } = gesture
    const { clientX: x, clientY: y } = point
    const dragged = moved || Math.hypot(x - gesture.x, y - gesture.y) >= MOVE_THRESHOLD
    const { innerWidth: width, innerHeight: height } = window
    clear()
    if (!active) return
    event.preventDefault()
    suppressedClick = { row, until: Date.now() + 650 }
    if (!dragged || !list.contains(row) || (x >= 0 && x < width && y >= 0 && y < height)) return
    const recordId = row.dataset.mistakeDragRecord
    if (recordId) onDrop({ recordId, x, y, width, height }, native)
  }

  function cancel() {
    if (gesture?.active) suppressedClick = { row: gesture.row, until: Date.now() + 650 }
    clear()
  }

  function cancelOnEscape(event) {
    if (event.key === "Escape") cancelNative()
  }

  function cancelNative() {
    if (gesture?.dragId) onCancel(gesture.dragId)
    cancel()
  }

  function cancelPointer(event) {
    if (eventPoint(event)) cancel()
  }

  function click(event) {
    if (event.detail === 0 || !suppressedClick || !suppressedClick.row.contains(event.target)) return
    if (Date.now() <= suppressedClick.until) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    suppressedClick = undefined
  }

  function suppressMenu(event) {
    if (gesture && gesture.row.contains(event.target)) event.preventDefault()
  }

  const listeners = [
    [list, "touchstart", startTouch, { passive: true }],
    [list, mouseDown, startMouse],
    [document, "touchmove", move, { capture: true, passive: false }],
    [document, "touchend", end, { capture: true, passive: false }],
    [document, "touchcancel", cancel, true],
    [document, mouseMove, move, true],
    [document, mouseUp, end, true],
    [document, "pointercancel", cancelPointer, true],
    [document, "lostpointercapture", cancelPointer, true],
    [document, "keydown", cancelOnEscape, true],
    [list, "click", click, true],
    [list, "contextmenu", suppressMenu],
    [window, "blur", cancel],
    [window, "pagehide", cancelNative],
    [window, "cardlink-panel-hide", cancelNative],
  ]
  for (const [target, type, callback, options] of listeners) target.addEventListener(type, callback, options)
  return () => {
    for (const [target, type, callback, options] of listeners) target.removeEventListener(type, callback, options)
    cancelNative()
  }
}
