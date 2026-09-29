import React, { useEffect, useRef } from "react"
import { mountCardPreview } from "../../src/card-preview"
import { wireFramePinchZoom } from "../../src/pinch-zoom"

const commentOpenStates = new Map()

// 同一个组件覆盖详情原题/答案、复习原题/答案；导出是静态排版，不绑定交互手势。
export const CardPreview = React.memo(function CardPreview({ html, title, zoom = 100, onZoom, onInteract, initialAutoHeight = false, defaultExpandedComments }) {
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
    const comments = Array.from(win.document.querySelectorAll("details.card-comment[data-comment-key]"))
    const unsubComments = comments.map((comment, index) => {
      const key = `cardlink.comment.${comment.dataset.commentKey}`
      let saved = commentOpenStates.get(key)
      if (saved === undefined) {
        try { saved = window.localStorage.getItem(key) } catch { /* file WebViews may not expose storage */ }
      }
      if (saved === "open" || saved === "closed") comment.open = saved === "open"
      else if (Number.isInteger(defaultExpandedComments)) comment.open = index < defaultExpandedComments
      const summary = comment.querySelector("summary")
      const onClick = () => setTimeout(() => {
        const value = comment.open ? "open" : "closed"
        commentOpenStates.set(key, value)
        try { window.localStorage.setItem(key, value) } catch { /* session memory still remembers */ }
      }, 0)
      summary?.addEventListener("click", onClick)
      return () => summary?.removeEventListener("click", onClick)
    })
    controller.setScale(zoom / 100)
    if (initialAutoHeight) frame.style.height = Math.max(300, Math.min(520, controller.naturalHeight())) + "px"
    const unsubscribe = controller.subscribe(value => callbacks.current.onZoom?.(Math.round(value * 100)))
    const interact = () => callbacks.current.onInteract?.()
    const click = () => frame.dispatchEvent(new CustomEvent("cardlink-preview-click", { bubbles: true }))
    win.document.addEventListener("pointerdown", interact, true)
    win.document.addEventListener("touchstart", interact, { passive: true })
    win.document.addEventListener("click", click)
    cleanupRef.current = () => {
      unsubscribe(); unsubComments.forEach(unsub => unsub()); win.document.removeEventListener("pointerdown", interact, true)
      win.document.removeEventListener("touchstart", interact)
      win.document.removeEventListener("click", click)
      controller.destroy()
    }
  }
  return <iframe ref={frameRef} title={title} aria-description={html?.includes("data-bound-handwriting hidden") ? "双击预览区域显示或隐藏脑图绑定手写" : undefined} srcDoc={html} scrolling="auto" onLoad={loaded} style={{ colorScheme: "light" }} />
})
