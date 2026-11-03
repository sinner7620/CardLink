import kinetic from "panzoom/lib/kinetic"

/** Library-owned gestures and inertia; the adapter bounds content and isolates pen input. */
export function mountCardPreview(win: any, Panzoom: any): any {
  if (win.__mnCardPreview) return win.__mnCardPreview
  const doc = win.document, root = doc.documentElement, body = doc.body
  if (!body) return
  let card = doc.querySelector('.card')
  if (!card) {
    card = doc.createElement('div'); card.className = 'cardPreviewContent'
    card.style.padding = win.getComputedStyle?.(body).padding || '0'; body.style.padding = '0'
    while (body.firstChild) card.appendChild(body.firstChild)
    body.appendChild(card)
  }
  Object.assign(root.style, { colorScheme: 'light', overflow: 'hidden', height: '100%', touchAction: 'none' })
  Object.assign(body.style, { overflow: 'hidden', margin: '0', width: '100%', height: '100%', background: '#fff' })
  Object.assign(card.style, { boxSizing: 'border-box', position: 'relative', width: '100%', maxWidth: 'none' })
  doc.querySelector('meta[name="viewport"]')?.setAttribute?.('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no')
  const listeners = new Set<any>(), cleanups: Array<() => void> = [], pointers = new Map<any, string>()
  let engine: any, scheduled = 0, destroyed = false, multiple = false, cancelled = false
  let rendered: { x: number; y: number; scale: number } | undefined
  const inertia = kinetic(() => engine.getPan(), (x: number, y: number) => { if (!destroyed) engine.pan(x, y) }, {
    amplitude: .342, minVelocity: 5,
    requestAnimationFrame: (fn: any) => win.requestAnimationFrame(fn), cancelAnimationFrame: (id: any) => win.cancelAnimationFrame(id)
  })
  function bounded(value: number, size: number, viewport: number, scale: number) {
    const origin = size * (1 - scale) / 2, limit = viewport - size * scale, position = origin + value * scale
    return ((limit >= 0 ? limit / 2 : Math.max(limit, Math.min(0, position))) - origin) / scale
  }
  function paint() {
    if (destroyed || !engine) return
    const scale = engine.getScale(), pan = engine.getPan()
    if (rendered && rendered.x === pan.x && rendered.y === pan.y && rendered.scale === scale) return
    const x = bounded(pan.x, card.offsetWidth, root.clientWidth || win.innerWidth, scale)
    const y = bounded(pan.y, card.offsetHeight, root.clientHeight || win.innerHeight, scale)
    if (Math.abs(x - pan.x) > .001 || Math.abs(y - pan.y) > .001) engine.pan(x, y, { silent: true })
    Panzoom.defaultOptions.setTransform(card, { x, y, scale, isSVG: false })
    if (!rendered || rendered.scale !== scale) root.dataset.previewScale = scale.toFixed(2)
    rendered = { x, y, scale }
  }
  function layout() { scheduled = 0; inertia.cancel(); rendered = undefined; paint() }
  function schedule() { if (!destroyed && !scheduled) scheduled = win.setTimeout(layout, 0) }
  function listen(target: any, names: string, handler: any, options?: any) {
    names.split(' ').forEach(name => {
      target.addEventListener(name, handler, options); cleanups.push(() => target.removeEventListener(name, handler, options))
    })
  }
  engine = Panzoom(card, { minScale: .6, maxScale: 3, step: .75, canvas: true, pinchAndPan: false,
    noBind: true, animate: false, touchAction: 'none', setTransform: paint,
    exclude: Array.from(doc.querySelectorAll('a,button,input,select,textarea,summary')) })
  function cancelPointers() {
    cancelled = true
    for (const pointerId of pointers.keys()) engine.handleUp({ pointerId, type: 'pointercancel' })
    pointers.clear(); inertia.cancel()
  }
  listen(body, engine.eventNames.down, (event: any) => {
    if (event.target?.closest?.('a,button,input,select,textarea,summary')) return
    const kind = event.pointerType || (event.pointerId != null ? 'touch' : 'mouse')
    if (kind === 'pen') cancelPointers()
    else if ([...pointers.values()].some(value => value !== kind)) return
    inertia.cancel()
    if (!pointers.size) { multiple = false; cancelled = false }
    pointers.set(event.pointerId ?? 'mouse', kind)
    if (pointers.size > 1 || event.touches?.length > 1) multiple = true
    engine.handleDown(event)
    if (event.pointerId != null) {
      try { body.setPointerCapture?.(event.pointerId) } catch { /* Synthetic or ended pointer. */ }
    }
  })
  listen(doc, engine.eventNames.move, (event: any) => {
    if (!pointers.has(event.pointerId ?? 'mouse')) return
    if (event.pointerType === 'pen' && event.buttons === 0 && event.pressure === 0) { cancelPointers(); return }
    engine.handleMove(event)
    // Only focal zoom needs synchronous geometry; ordinary pan uses the library's frame.
    if (pointers.size > 1 || event.touches?.length > 1) paint()
  }, { passive: true })
  listen(doc, engine.eventNames.up + ' lostpointercapture', (event: any) => {
    if (!pointers.has(event.pointerId ?? 'mouse')) return
    cancelled = /cancel|leave|lostpointercapture/.test(event.type)
    engine.handleUp(event)
    if (!event.touches?.length) pointers.delete(event.pointerId ?? 'mouse')
    if (cancelled) inertia.cancel()
  }, { passive: true })
  listen(win, 'blur', cancelPointers)
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancelPointers() })
  listen(card, 'panzoomstart', () => { if (!multiple) inertia.start() })
  listen(card, 'panzoomend', () => {
    if (!multiple && !cancelled && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) inertia.stop()
    else inertia.cancel()
  })
  listen(doc, 'gesturestart gesturechange gestureend', (event: any) => event.preventDefault(), { passive: false })
  const announce = () => { if (!destroyed) listeners.forEach(listener => listener(engine.getScale())) }
  listen(card, 'panzoomend panzoomzoom', announce)
  listen(body, 'wheel', (event: any) => {
    event.preventDefault(); inertia.cancel()
    if (event.ctrlKey || event.metaKey) { engine.zoomWithWheel(event, { step: .3 }); paint(); return }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? win.innerHeight : 1
    engine.pan(-event.deltaX * unit / engine.getScale(), -event.deltaY * unit / engine.getScale(), { relative: true })
  }, { passive: false })
  const handwriting = doc.querySelector('[data-bound-handwriting]:not([data-bound-handwriting="always"])')
  let toggle: any
  if (handwriting) {
    toggle = doc.createElement('button'); toggle.type = 'button'
    const update = () => {
      toggle.textContent = handwriting.hidden ? '显示脑图手写' : '隐藏脑图手写'; toggle.setAttribute('aria-expanded', String(!handwriting.hidden))
    }
    toggle.onclick = () => { handwriting.hidden = !handwriting.hidden; update(); layout() }
    update(); handwriting.before(toggle)
  }
  listen(win, 'resize', schedule); listen(doc, 'load toggle', schedule, true)
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null
  observer?.observe(card)
  const controller = {
    getScale: () => engine.getScale(),
    setScale(value: number) {
      const requested = Math.max(.6, Math.min(3, Number(value) || 1))
      if (Math.round(requested * 100) === Math.round(engine.getScale() * 100)) return
      inertia.cancel(); engine.zoomToPoint(requested, { clientX: win.innerWidth / 2, clientY: win.innerHeight / 2 }); paint()
    },
    naturalHeight: () => card.scrollHeight,
    subscribe(listener: any) { listeners.add(listener); return () => listeners.delete(listener) },
    destroy() {
      destroyed = true; inertia.cancel(); pointers.clear(); cleanups.forEach(cleanup => cleanup())
      engine.destroy(); observer?.disconnect(); win.clearTimeout(scheduled); toggle?.remove(); listeners.clear()
      if (win.__mnCardPreview === controller) delete win.__mnCardPreview
    }
  }
  win.__mnCardPreview = controller; layout(); return controller
}
