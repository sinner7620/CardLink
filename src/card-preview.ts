/** 原生答案 WebView 与 Web iframe 的唯一内容/缩放控制器。
 * 完全自包含：renderCardHtml 将本函数和同一手势内核序列化到 HTML。
 */
export function mountCardPreview(win: any, wirePinch: any): any {
  if (win.__mnCardPreview) return win.__mnCardPreview
  const doc = win.document, body = doc.body, root = doc.documentElement
  if (!body) return
  let card = doc.querySelector(".card")
  if (!card) {
    card = doc.createElement("div")
    card.className = "cardPreviewContent"
    card.style.padding = win.getComputedStyle?.(body).padding || "0"
    body.style.padding = "0"
    while (body.firstChild) card.appendChild(body.firstChild)
    body.appendChild(card)
  }
  root.style.colorScheme = "light"
  root.style.overflow = "auto"
  root.style.touchAction = "pan-x pan-y"
  body.style.overflow = "hidden"
  body.style.margin = "0"
  body.style.background = "#fff"
  card.style.boxSizing = "border-box"
  card.style.transformOrigin = "0 0"
  card.style.position = "relative"
  let scale = 1, focusX = 0, focusY = 0, scheduled = 0
  let offsetX = 0, offsetY = 0, renderedViewportHeight = 0
  let renderedWidth = 0, renderedHeight = 0, renderedScale = 0
  let width = Math.max(1, root.clientWidth || win.innerWidth)
  const listeners = new Set<any>()
  function layout() {
    scheduled = 0
    card.style.width = width + "px"
    const height = Math.max(1, card.scrollHeight)
    const viewportHeight = root.clientHeight || win.innerHeight
    if (renderedWidth === width && renderedHeight === height && renderedScale === scale && renderedViewportHeight === viewportHeight) return
    renderedViewportHeight = viewportHeight
    renderedWidth = width
    renderedHeight = height
    renderedScale = scale
    card.style.width = width + "px"
    card.style.maxWidth = "none"
    card.style.transform = scale === 1 ? "none" : "scale(" + scale + ")"
    offsetX = Math.max(0, (width - width * scale) / 2)
    offsetY = scale < 1 ? Math.max(0, (viewportHeight - height * scale) / 2) : 0
    card.style.left = offsetX + "px"
    card.style.top = offsetY + "px"
    // 不在100%时常驻 will-change 合成层；仅内容缩放，不缩放整个 document。
    body.style.width = Math.ceil(Math.max(width, width * scale)) + "px"
    body.style.height = Math.ceil(Math.max(viewportHeight, height * scale)) + "px"
    root.dataset.previewScale = scale.toFixed(2)
  }
  function schedule() { if (!scheduled) scheduled = win.setTimeout(layout, 0) }
  function announce() { listeners.forEach(listener => listener(scale)) }
  function setScale(value: number, point?: any) {
    const next = Math.max(.6, Math.min(3, Number(value) || 1))
    // React 工具条与 iframe 手势共享控制器时会把同一比例回写一次；相同比例
    // 不再重复改 document 几何和 scrollTo，避免缩放锚点来回抖动。
    if (Math.abs(next - scale) < .001) return
    scale = next
    layout()
    if (point) win.scrollTo(Math.max(0, offsetX + focusX * scale - point.x), Math.max(0, offsetY + focusY * scale - point.y))
  }
  function remember(point: any) { focusX = (win.scrollX + point.x - offsetX) / scale; focusY = (win.scrollY + point.y - offsetY) / scale }
  const handwriting = doc.querySelector("[data-bound-handwriting]")
  let tapStart: any = null, lastTap: any = null, lastToggle = 0
  function toggleHandwriting() {
    if (!handwriting) return
    handwriting.hidden = !handwriting.hidden
    layout()
  }
  function doubleClick(event: any) {
    if (!handwriting) return
    event.preventDefault()
    if (Date.now() - lastToggle < 500) return
    toggleHandwriting()
  }
  function tapBegin(event: any) {
    if (event.touches.length !== 1) { tapStart = null; lastTap = null; return }
    tapStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() }
  }
  function tapMove(event: any) {
    if (!tapStart) return
    if (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - tapStart.x, event.touches[0].clientY - tapStart.y) > 12) {
      tapStart = null; lastTap = null
    }
  }
  function tapEnd(event: any) {
    if (!handwriting || !tapStart || event.touches.length || Date.now() - tapStart.at > 300) { tapStart = null; return }
    if (lastTap && tapStart.at - lastTap.at < 350 && Math.hypot(tapStart.x - lastTap.x, tapStart.y - lastTap.y) < 24) {
      event.preventDefault(); toggleHandwriting(); lastToggle = Date.now(); lastTap = null
    } else lastTap = tapStart
    tapStart = null
  }
  function tapCancel() { tapStart = null; lastTap = null }
  doc.addEventListener("dblclick", doubleClick)
  doc.addEventListener("touchstart", tapBegin, { passive: true })
  doc.addEventListener("touchmove", tapMove, { passive: true })
  doc.addEventListener("touchend", tapEnd, { passive: false })
  doc.addEventListener("touchcancel", tapCancel)
  const unbind = wirePinch(doc, {
    getScale: () => scale, applyScale: setScale, onPinchStart: remember, onGestureStart: remember,
    onPinchEnd: announce, clientWidth: () => win.innerWidth / 2, clientHeight: () => win.innerHeight / 2
  })
  function resize() { width = Math.max(1, root.clientWidth || win.innerWidth); schedule() }
  win.addEventListener("resize", resize)
  doc.addEventListener("load", schedule, true)
  const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : null
  observer?.observe(card)
  const controller = {
    getScale: () => scale, setScale,
    naturalHeight: () => card.scrollHeight,
    subscribe(listener: any) { listeners.add(listener); return () => listeners.delete(listener) },
    destroy() {
      unbind?.(); observer?.disconnect(); win.clearTimeout(scheduled)
      win.removeEventListener("resize", resize); doc.removeEventListener("load", schedule, true)
      doc.removeEventListener("dblclick", doubleClick)
      doc.removeEventListener("touchstart", tapBegin); doc.removeEventListener("touchmove", tapMove)
      doc.removeEventListener("touchend", tapEnd); doc.removeEventListener("touchcancel", tapCancel)
      listeners.clear(); if (win.__mnCardPreview === controller) delete win.__mnCardPreview
    }
  }
  win.__mnCardPreview = controller
  layout()
  return controller
}
