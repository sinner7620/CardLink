import { useLayoutEffect, useRef, useState } from "react"

import { dockPosition, nearestDockEdge } from "./detail-dock-geometry"

const KEY = "mn-detail-bar"
export function useDockableBar() {
  const [saved, setSaved] = useState(() => {
    try {
      const item = JSON.parse(localStorage.getItem(KEY))
      if (["top", "bottom", "left", "right"].includes(item?.edge) && Number.isFinite(item.ratio))
        return { ...item, ratio: Math.max(0, Math.min(1, item.ratio)) }
    } catch {}
    return { edge: "bottom", ratio: .5, collapsed: false }
  })
  const stageRef = useRef(null)
  const controlRef = useRef(null)
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState(null)
  const [hiddenLabels, setHiddenLabels] = useState([])
  const liveEdge = drag?.edge || saved.edge
  const orientation = liveEdge === "left" || liveEdge === "right" ? "vertical" : "horizontal"
  const [bounds, setBounds] = useState({ stage: { width: 0, height: 0 }, bar: { width: 0, height: 0 } })
  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current, bar = controlRef.current?.querySelector(".detailActionBar")
      if (!stage || !bar) return
      const count = bar.children.length
      const controlSize = Math.min(32, Math.max(22, (stage.clientWidth - 28 - (count - 1) * 3) / Math.max(1, count)))
      bar.style.setProperty("--dock-control-size", `${controlSize}px`)
      const labels = Array.from(bar.querySelectorAll(".barText"))
      const widths = Object.fromEntries(labels.map(label => [label.dataset.dockLabel, label.scrollWidth + 4]))
      let fullWidth = count * 32 + (count - 1) * 3 + 12 + Object.values(widths).reduce((sum, value) => sum + value, 0)
      const nextHidden = []
      if (orientation === "vertical") nextHidden.push(...Object.keys(widths))
      else for (const key of ["delete", "locate", "answer", "question"]) {
        if (fullWidth <= stage.clientWidth - 28) break
        if (!widths[key]) continue
        nextHidden.push(key)
        fullWidth -= widths[key]
      }
      setHiddenLabels(previous => previous.join("|") === nextHidden.join("|") ? previous : nextHidden)
      const next = { stage: { width: stage.clientWidth, height: stage.clientHeight }, bar: { width: bar.offsetWidth + 2, height: bar.offsetHeight + 2 } }
      setBounds(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
    }
    measure()
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
    if (stageRef.current) observer?.observe(stageRef.current)
    if (controlRef.current?.firstElementChild) observer?.observe(controlRef.current.firstElementChild)
    window.addEventListener("resize", measure)
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure) }
  })
  function persist(next) {
    setSaved(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  }
  function start(point, target) {
    suppressClick.current = false
    if (target.closest("select, option, input")) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    gesture.current = { x: point.clientX, y: point.clientY, rect }
  }
  function move(point) {
    const state = gesture.current
    if (!state || (!suppressClick.current && Math.hypot(point.clientX - state.x, point.clientY - state.y) < 6)) return false
    suppressClick.current = true
    const x = point.clientX - state.rect.left, y = point.clientY - state.rect.top
    setDrag({ x, y, edge: nearestDockEdge(x, y, state.rect.width, state.rect.height) })
    return true
  }
  function end(point, cancelled = false) {
    const state = gesture.current
    gesture.current = null
    setDrag(null)
    if (!state || !suppressClick.current || cancelled) return
    const x = point.clientX - state.rect.left, y = point.clientY - state.rect.top
    const edge = nearestDockEdge(x, y, state.rect.width, state.rect.height)
    const ratio = edge === "top" || edge === "bottom" ? x / state.rect.width : y / state.rect.height
    persist({ ...saved, edge, ratio: Math.max(0, Math.min(1, ratio)) })
  }
  const handlers = {
    onClickCapture(event) { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() } },
    onPointerDown(event) { if (event.button === 0) start(event, event.target) },
    onPointerMove(event) { if (move(event)) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) } },
    onPointerUp(event) { end(event) },
    onPointerCancel(event) { end(event, true) },
    onTouchStart(event) { if (!window.PointerEvent && event.touches.length === 1) start(event.touches[0], event.target) },
    onTouchMove(event) { if (!window.PointerEvent && event.touches.length === 1) move(event.touches[0]) },
    onTouchEnd(event) { if (!window.PointerEvent) end(event.changedTouches[0]) },
    onTouchCancel(event) { if (!window.PointerEvent) end(event.changedTouches[0], true) }
  }
  const size = saved.collapsed ? { width: 40, height: 40 } : bounds.bar
  return { stageRef, controlRef, handlers, collapsed: saved.collapsed, dragging: !!drag, hiddenLabels, orientation,
    style: { ...dockPosition(bounds.stage, size, liveEdge, saved.ratio, drag), width: size.width, height: size.height, visibility: bounds.stage.width ? "visible" : "hidden" },
    setCollapsed: collapsed => persist({ ...saved, collapsed }) }
}
