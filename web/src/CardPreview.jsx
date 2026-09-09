import React, { useEffect, useRef } from "react"
import { mountCardPreview } from "../../src/card-preview"
import { wireFramePinchZoom } from "../../src/pinch-zoom"

// 同一个组件覆盖详情原题/答案、复习原题/答案；导出是静态排版，不绑定交互手势。
export const CardPreview = React.memo(function CardPreview({ html, title, zoom = 100, onZoom, onInteract, initialAutoHeight = false }) {
  const frameRef = useRef(null), cleanupRef = useRef(() => {})
  const callbacks = useRef({ onZoom, onInteract })
  callbacks.current = { onZoom, onInteract }
  useEffect(() => {
    frameRef.current?.contentWindow?.__mnCardPreview?.setScale(zoom / 100)
  }, [zoom])
  useEffect(() => () => cleanupRef.current(), [])
  function loaded() {
    cleanupRef.current()
    const frame = frameRef.current, win = frame?.contentWindow
    if (!win) return
    const controller = mountCardPreview(win, wireFramePinchZoom)
    if (!controller) return
    controller.setScale(zoom / 100)
    if (initialAutoHeight) frame.style.height = Math.max(300, Math.min(520, controller.naturalHeight())) + "px"
    const unsubscribe = controller.subscribe(value => callbacks.current.onZoom?.(Math.round(value * 100)))
    const interact = () => callbacks.current.onInteract?.()
    win.document.addEventListener("pointerdown", interact, true)
    win.document.addEventListener("touchstart", interact, { passive: true })
    cleanupRef.current = () => {
      unsubscribe(); win.document.removeEventListener("pointerdown", interact, true)
      win.document.removeEventListener("touchstart", interact)
      controller.destroy()
    }
  }
  return <iframe ref={frameRef} title={title} srcDoc={html} scrolling="auto" onLoad={loaded} style={{ colorScheme: "light" }} />
})
