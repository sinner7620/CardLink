import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { LiquidGlassRenderer } from "../../vendor/liquid-glass-webgl/src/components/liquid-glass/renderer"
import { useGestureHandlers } from "../../vendor/liquid-glass-webgl/src/components/liquid-glass/context/pointer-handlers"
import { useRendererPropSync } from "../../vendor/liquid-glass-webgl/src/components/liquid-glass/context/use-renderer-prop-sync"
import { DEFAULT_CATALOG_STATE } from "../../vendor/liquid-glass-webgl/src/components/liquid-glass/catalog/types"
import { makeButton } from "../../vendor/liquid-glass-webgl/src/components/liquid-glass/catalog/helpers-elements"

// The original renderer draws one wallpaper for the whole panel, so footer
// buttons sample that same background instead of independently rescaling it.
export function useSizeGlassFooter(onResize, onClose, layoutRevision) {
  const surface = useRef(null), form = useRef(null), canvasRef = useRef(null)
  const reset = useRef(null), done = useRef(null), rendererRefInternal = useRef(null)
  const elementsRef = useRef([]), interactionsRef = useRef({}), gesturesRef = useRef(new Map()), prevPinchRef = useRef(null)
  const pendingFrame = useRef(0), viewport = useRef({ width: 0, height: 0 })
  const [failure, setFailure] = useState("")
  interactionsRef.current = { reset: { onTap: () => onResize(640, 620) }, done: { onTap: onClose } }
  const measure = useCallback(() => {
    const renderer = rendererRefInternal.current
    if (!renderer || !surface.current || !canvasRef.current) return
    const bounds = surface.current.getBoundingClientRect()
    if (bounds.width !== viewport.current.width || bounds.height !== viewport.current.height) {
      viewport.current = { width: bounds.width, height: bounds.height }
      renderer.resize(bounds.width, bounds.height)
      renderer.setContentHeight(bounds.height)
    }
    const controls = [["reset", "恢复默认", reset.current], ["done", "完成", done.current]].filter(([, , node]) => node).map(([id, label, node]) => {
      const rect = node.getBoundingClientRect()
      const control = makeButton(id, { x: rect.left - bounds.left, y: rect.top - bounds.top, w: rect.width, h: rect.height }, {
        label, tintColor: [0x00 / 255, 0x88 / 255, 0xff / 255, 0.45],
        surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1], labelFontSizePx: 14
      }, false)
      control.useContinuousSdf = DEFAULT_CATALOG_STATE.capsuleShape
      control.useSeparableBlur = DEFAULT_CATALOG_STATE.globalSeparableBlur
      return control
    })
    elementsRef.current = controls
    renderer.setElements(controls)
  }, [])
  const queueMeasure = useCallback(() => {
    if (!pendingFrame.current) pendingFrame.current = requestAnimationFrame(() => { pendingFrame.current = 0; measure() })
  }, [measure])
  const handlers = useGestureHandlers({ canvasRef, rendererRefInternal, elementsRef, interactionsRef, gesturesRef, prevPinchRef })
  useEffect(() => {
    // DOM buttons sit above the canvas. Forward the entire active gesture
    // even when WKWebView cannot retain the canvas's pointer capture.
    const move = event => { if (gesturesRef.current.has(event.pointerId)) handlers.handlePointerMove(event) }
    const up = event => { if (gesturesRef.current.has(event.pointerId)) handlers.handlePointerUp(event) }
    const cancelPointer = pointerId => {
      const gesture = gesturesRef.current.get(pointerId)
      if (!gesture) return
      gesturesRef.current.delete(pointerId)
      if (gesture.pressedId) rendererRefInternal.current?.setPressed(gesture.pressedId, false)
      const canvas = canvasRef.current
      if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    }
    const cancel = event => cancelPointer(event.pointerId)
    const cancelAll = () => { for (const id of gesturesRef.current.keys()) cancelPointer(id) }
    const visibility = () => { if (document.hidden) cancelAll() }
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", up, true)
    window.addEventListener("pointercancel", cancel, true)
    window.addEventListener("lostpointercapture", cancel, true)
    window.addEventListener("blur", cancelAll)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", up, true)
      window.removeEventListener("pointercancel", cancel, true)
      window.removeEventListener("lostpointercapture", cancel, true)
      window.removeEventListener("blur", cancelAll)
      document.removeEventListener("visibilitychange", visibility)
      cancelAll()
    }
  }, [handlers.handlePointerMove, handlers.handlePointerUp])
  useEffect(() => {
    let renderer, observer, disposed = false
    const canvas = canvasRef.current, scrollForm = form.current
    const fail = reason => { if (!disposed) setFailure(reason?.message || "WebGL 加载失败") }
    const lost = event => { event.preventDefault(); fail(new Error("WebGL 上下文已丢失")) }
    try {
      renderer = new LiquidGlassRenderer(canvas)
      rendererRefInternal.current = renderer
      measure()
      observer = new ResizeObserver(queueMeasure)
      observer.observe(surface.current)
      scrollForm.addEventListener("scroll", queueMeasure, { passive: true })
      const base = window.__MN_SCENE_ENABLED__ ? "/pkg/web-dist/" : "/"
      renderer.loadWallpaper(base + "size-grid.svg").catch(fail)
      canvas.addEventListener("webglcontextlost", lost)
    } catch (error) { fail(error) }
    return () => {
      disposed = true
      observer?.disconnect()
      scrollForm.removeEventListener("scroll", queueMeasure)
      canvas.removeEventListener("webglcontextlost", lost)
      cancelAnimationFrame(pendingFrame.current)
      renderer?.dispose()
      rendererRefInternal.current = null
    }
  }, [measure, queueMeasure])
  useRendererPropSync(rendererRefInternal, surface, { ...DEFAULT_CATALOG_STATE, dpr: DEFAULT_CATALOG_STATE.customDpr })
  useLayoutEffect(queueMeasure, [layoutRevision, queueMeasure])
  return {
    surface, form, canvasRef, reset, done, failure,
    pointerDown: event => { measure(); handlers.handlePointerDown(event) }
  }
}
