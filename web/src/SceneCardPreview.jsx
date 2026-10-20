import React, { useEffect, useMemo, useRef, useState } from "react"
import { wireFramePinchZoom } from "../../src/pinch-zoom"
import "./scene-card-preview.css"

// Scene CSP permits same-origin images, but not data: images or the classic
// card document's inline scripts/styles. Use the documented host PNG route.
export function SceneCardPreview({ noteId, html, title, zoom = 100, onZoom, onInteract, initialAutoHeight = false }) {
  const viewport = useRef(null), callbacks = useRef({ onZoom }), scaleRef = useRef(zoom / 100)
  callbacks.current = { onZoom }
  const [scale, setScale] = useState(zoom / 100)
  const [retry, setRetry] = useState(0), [state, setState] = useState("loading")
  const revision = useRef(0)
  const imageKey = useMemo(() => ++revision.current, [noteId, html, retry])
  useEffect(() => { setState("loading") }, [noteId, html, retry])
  useEffect(() => { scaleRef.current = zoom / 100; setScale(zoom / 100) }, [zoom])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    return wireFramePinchZoom(element, {
      getScale: () => scaleRef.current,
      applyScale(value) {
        const next = Math.max(.6, Math.min(3, value))
        scaleRef.current = next; setScale(next); callbacks.current.onZoom?.(Math.round(next * 100))
      },
      clientWidth: () => element.clientWidth / 2, clientHeight: () => element.clientHeight / 2
    })
  }, [])
  const src = '/bridge/v1/notes/' + encodeURIComponent(noteId) + '/render?format=png&width=880'
  function failed() {
    setState("error")
    window.mn?.call("sceneLog", { event: "preview.renderFailed", detail: "noteid=" + noteId }).catch(() => {})
  }
  return <div ref={viewport} className={`sceneCardPreview ${initialAutoHeight ? "autoHeight" : ""}`} onPointerDown={onInteract} aria-label={title}>
    {state === "loading" && <p className="scenePreviewStatus" role="status">正在读取卡片预览…</p>}
    {state === "error" && <div className="scenePreviewStatus" role="alert">卡片预览加载失败。<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    <div className="scenePreviewImageWidth" style={{ width: `${scale * 100}%`, marginInline: scale < 1 ? "auto" : 0 }}>
      <img key={imageKey} src={src} alt={title} hidden={state === "error"} onLoad={() => setState("ready")} onError={failed} />
    </div>
  </div>
}
