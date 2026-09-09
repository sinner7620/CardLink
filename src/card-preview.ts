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
  body.style.overflow = "visible"
  body.style.margin = "0"
  body.style.background = "#fff"
  card.style.boxSizing = "border-box"
  card.style.transformOrigin = "0 0"
  let scale = 1, focusX = 0, focusY = 0, scheduled = 0
  let renderedWidth = 0, renderedHeight = 0, renderedScale = 0
  let width = Math.max(1, root.clientWidth || win.innerWidth)
  const listeners = new Set<any>()
  function layout() {
    scheduled = 0
    const height = Math.max(1, card.scrollHeight)
    if (renderedWidth === width && renderedHeight === height && renderedScale === scale) return
    renderedWidth = width
    renderedHeight = height
    renderedScale = scale
    card.style.width = width + "px"
    card.style.maxWidth = "none"
    card.style.transform = scale === 1 ? "none" : "scale(" + scale + ")"
    // 不在100%时常驻 will-change 合成层；仅内容缩放，不缩放整个 document。
    body.style.width = Math.ceil(width * scale) + "px"
    body.style.height = Math.ceil(height * scale) + "px"
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
    if (point) win.scrollTo(Math.max(0, focusX * scale - point.x), Math.max(0, focusY * scale - point.y))
  }
  function remember(point: any) { focusX = (win.scrollX + point.x) / scale; focusY = (win.scrollY + point.y) / scale }
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
      listeners.clear(); if (win.__mnCardPreview === controller) delete win.__mnCardPreview
    }
  }
  win.__mnCardPreview = controller
  layout()
  return controller
}
