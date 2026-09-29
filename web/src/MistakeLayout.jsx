import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import "./ui/mistake-drawer.css"

/** The list keeps its scroll/filter state when moved out of view. */
export function MistakeLayout({ autoHide, children }) {
  const [open, setOpen] = useState(true)
  const [dragging, setDragging] = useState(false)
  const panel = useRef(null), edge = useRef(null), root = useRef(null), gesture = useRef(null)
  const frame = useRef(0), pendingProgress = useRef(null)
  const suppressClick = useRef(false)
  function paintProgress() {
    frame.current = 0
    if (pendingProgress.current !== null) root.current?.style.setProperty("--drawer-visible-width", `${pendingProgress.current}px`)
    pendingProgress.current = null
  }
  function releaseProgress() {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    pendingProgress.current = null
    root.current?.removeAttribute("data-drawer-held")
    root.current?.style.removeProperty("--drawer-visible-width")
  }
  const close = () => {
    if (panel.current?.contains(document.activeElement)) edge.current?.focus()
    gesture.current = null
    releaseProgress()
    setDragging(false)
    setOpen(false)
  }
  useLayoutEffect(() => {
    gesture.current = null
    setDragging(false)
    setOpen(true)
    root.current?.style.removeProperty("--drawer-visible-width")
    if (!autoHide) return
    const measure = () => {
      const width = root.current?.clientWidth
      const drawerWidth = panel.current?.getBoundingClientRect().width
      if (!width || !drawerWidth) return
      root.current.setAttribute("data-drawer-measuring", "")
      root.current.style.setProperty("--drawer-width", `${drawerWidth}px`)
      if (gesture.current) {
        gesture.current = null
        setDragging(false)
        releaseProgress()
      }
      // Establish the resized widths before enabling transitions.
      getComputedStyle(root.current.firstElementChild).width
      root.current.removeAttribute("data-drawer-measuring")
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root.current)
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); pendingProgress.current = null }
  }, [autoHide])
  useEffect(() => {
    if (!autoHide || !open) return
    const outside = event => {
      // Portaled filter menus belong to the list; only close for workspace or app chrome.
      if (root.current?.contains(event.target) || event.target.closest(".datePopover,.categoryPopover,[role=dialog]")) return
      if (event.target.closest("#root")) close()
    }
    const escape = event => { if (event.key === "Escape") { close(); event.preventDefault() } }
    const stage = root.current?.querySelector(".mistakeDetailStage")
    stage?.addEventListener("cardlink-preview-click", close)
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); stage?.removeEventListener("cardlink-preview-click", close) }
  }, [autoHide, open])
  function begin(event) {
    if (!autoHide || !event.isPrimary || event.button !== 0 || event.target.closest("input,select,textarea")) return
    suppressClick.current = false
    const width = panel.current.getBoundingClientRect().width
    const transform = getComputedStyle(panel.current).transform
    const x = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41
    // Interrupt settling at its visible position, including a rapid reverse drag.
    root.current.setAttribute("data-drawer-held", "")
    root.current.style.setProperty("--drawer-visible-width", `${x + width}px`)
    // Capture immediately: a fast first move can leave the 24px edge and enter
    // the iframe before the horizontal threshold has been crossed.
    if (event.currentTarget === edge.current) event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { target: event.currentTarget, id: event.pointerId, x: event.clientX, y: event.clientY, start: x, width, lastX: event.clientX, time: event.timeStamp, velocity: 0, active: false, wasOpen: open }
  }
  function move(event) {
    const g = gesture.current
    if (!g || event.pointerId !== g.id) return
    const dx = event.clientX - g.x, dy = event.clientY - g.y
    if (!g.active) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { gesture.current = null; releaseProgress(); return }
      if (Math.abs(dx) < 8) return
      g.active = true
      g.target.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    g.velocity = (event.clientX - g.lastX) / Math.max(1, event.timeStamp - g.time)
    g.lastX = event.clientX; g.time = event.timeStamp
    g.position = Math.max(-g.width, Math.min(0, g.start + dx))
    // The visible list width also sets the detail region's actual width.
    pendingProgress.current = g.position + g.width
    if (!frame.current) frame.current = requestAnimationFrame(paintProgress)
    event.preventDefault()
  }
  function end(event, cancelled = false) {
    const g = gesture.current
    if (!g || event.pointerId !== g.id) return
    gesture.current = null
    if (!g.active) { releaseProgress(); return }
    cancelAnimationFrame(frame.current)
    paintProgress()
    // Commit the final pointer position before enabling the shared settling curve.
    getComputedStyle(panel.current).transform
    suppressClick.current = true
    const velocity = event.timeStamp - g.time < 100 ? g.velocity : 0
    const next = cancelled ? g.wasOpen : Math.abs(velocity) > .35 ? velocity > 0 : g.position > -g.width / 2
    setDragging(false)
    if (next) setOpen(true); else close()
    releaseProgress()
  }
  // Capture can move from a touched child to its parent during a drag; only
  // pointercancel (not lostpointercapture) means that the gesture was cancelled.
  const gestures = { onPointerDown: begin, onPointerMove: move, onPointerUp: event => end(event), onPointerCancel: event => end(event, true) }
  const [sidebar, detail] = React.Children.toArray(children)
  if (!autoHide) return <div className="browserGrid mistakeSplitView">{children}</div>
  return <div ref={root} className={`browserGrid mistakeSplitView ${autoHide ? "mistakeAutoHide" : ""} ${open ? "drawerOpen" : ""} ${dragging ? "drawerDragging" : ""}`}
    onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() } }}>
    <div className="mistakeDetailStage" onClickCapture={() => { if (open) close() }}>{detail}</div>
    {React.cloneElement(sidebar, { ref: panel, ...gestures, id: "mistake-drawer", inert: autoHide && !open && !dragging ? true : undefined })}
    {autoHide && <button ref={edge} type="button" className="mistakeDrawerEdge" aria-label={open ? "收起错题列表" : "展开错题列表"} aria-controls="mistake-drawer" aria-expanded={open} {...gestures} onClick={() => open ? close() : setOpen(true)}><span /></button>}
  </div>
}
