/**
 * iframe / 独立卡片 WebView 共用的双指缩放手势管线。
 * 本函数保持完全自包含，以便 card-html 可把同一实现序列化进独立文档。
 */
export function wireFramePinchZoom(target: any, options: any): () => void {
  const cleanups: Array<() => void> = []
  const listen = (name: string, handler: any, config: any) => {
    target.addEventListener(name, handler, config)
    cleanups.push(() => target.removeEventListener(name, handler, config))
  }
  const applyScale = options.applyScale
  const getScale = options.getScale
  const withGestureEvents = options.gestureEvents !== false
  const distance = (touches: any) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  const midpoint = (touches: any) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  })
  let startDistance = 0
  let startScale = 1
  let gestureActive = false
  const reanchor = (touches: any) => {
    startDistance = distance(touches)
    startScale = getScale()
    return midpoint(touches)
  }

  listen("touchstart", (event: any) => {
    if (event.touches.length !== 2) return
    const point = reanchor(event.touches)
    if (options.onPinchStart) options.onPinchStart(point)
  }, { passive: true })

  listen("touchmove", (event: any) => {
    // Safari可同时发送touch和gesture，只让一条序列计算缩放。
    if (gestureActive && event.touches.length === 2) { event.preventDefault(); return }
    if (event.touches.length > 2) {
      startDistance = 0
      return
    }
    if (event.touches.length !== 2) return
    if (!startDistance) {
      const point = reanchor(event.touches)
      if (options.onPinchStart) options.onPinchStart(point)
      return
    }
    event.preventDefault()
    applyScale(startScale * distance(event.touches) / startDistance, midpoint(event.touches))
  }, { passive: false })

  listen("touchend", (event: any) => {
    if (event.touches.length === 2) reanchor(event.touches)
    else if (event.touches.length < 2) {
      if (startDistance) options.onPinchEnd?.()
      startDistance = 0
    }
  }, { passive: true })
  listen("touchcancel", () => { startDistance = 0; gestureActive = false; options.onPinchEnd?.() }, { passive: true })

  if (withGestureEvents) {
    const gesturePoint = (event: any) => ({
      x: Number(event.clientX || (options.clientWidth ? options.clientWidth() : 0)),
      y: Number(event.clientY || (options.clientHeight ? options.clientHeight() : 0))
    })
    listen("gesturestart", (event: any) => {
      gestureActive = true
      startScale = getScale()
      startDistance = 0
      if (options.onGestureStart) options.onGestureStart(gesturePoint(event))
      event.preventDefault()
    }, { passive: false })
    listen("gesturechange", (event: any) => {
      event.preventDefault()
      applyScale(startScale * Number(event.scale || 1), gesturePoint(event))
    }, { passive: false })
    listen("gestureend", () => { gestureActive = false; options.onPinchEnd?.() }, { passive: true })
  }
  return () => cleanups.forEach(cleanup => cleanup())
}
