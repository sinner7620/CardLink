import React, { useEffect, useRef, useState } from "react"

// Shared with the overview's source distribution; retain its conic-gradient
// rendering instead of introducing another chart implementation.
export function distributionGradient(segments, total) {
  let offset = 0
  return total > 0 ? segments.filter(segment => segment.value > 0).map(segment => {
    const start = offset
    offset += segment.value / total * 100
    return `${segment.color} ${start}% ${offset}%`
  }).join(",") || "#e9edf5 0 100%" : "#e9edf5 0 100%"
}

// Animate values, not angles: deselected categories close while the remaining
// categories share the whole ring. Overview callers keep the original rendering.
function useSelectionValues(segments, enabled) {
  const target = segments.map(segment => enabled && !segment.selected ? 0 : segment.value)
  const key = target.join(",")
  const [values, setValues] = useState(target)
  const current = useRef(values)
  useEffect(() => {
    if (!enabled) return
    const start = current.current
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target; setValues(target); return
    }
    let frame, started
    function step(now) {
      started ??= now
      const progress = Math.min(1, (now - started) / 420)
      const eased = 1 - (1 - progress) ** 3
      const next = target.map((value, index) => (start[index] || 0) + (value - (start[index] || 0)) * eased)
      current.current = next; setValues(next)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [key, enabled])
  return enabled ? segments.map((segment, index) => ({ ...segment, value: values[index] || 0 })) : segments
}

export default function DistributionDonut({ segments, total, className = "sourceDonut", children, label, highlightSegments = false, animateSelection = false, formatValue }) {
  const displayed = useSelectionValues(segments, animateSelection)
  const displayedTotal = animateSelection ? displayed.reduce((sum, segment) => sum + segment.value, 0) : total
  const [active, setActive] = useState(null)
  const visible = displayed.filter(segment => segment.value > .001)
  const activeSegment = visible.find(segment => segment.id === active && segment.selected)
  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2
    const radius = Math.hypot(x, y) / (bounds.width / 2)
    if (radius < .52 || radius > 1.15) { setActive(null); return }
    let angle = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360, offset = 0
    const found = visible.find(segment => { offset += segment.value / displayedTotal * 360; return angle <= offset })
    setActive(previous => previous === found?.id ? null : found?.id)
  }
  if (highlightSegments) {
    let offset = 0
    return <div className={`${className} distributionLayers${animateSelection ? " distributionAnimated" : ""}`} role="img" aria-label={label} onClick={animateSelection ? inspect : undefined}>
      {visible.map((segment, index) => {
        const share = segment.value / displayedTotal
        const start = offset; offset += share * 360
        const middle = (start + offset) / 2 * Math.PI / 180
        const popped = activeSegment?.id === segment.id
        const gap = Math.min(.35, (offset - start) / 4)
        const fill = animateSelection && visible.length > 1
          ? `conic-gradient(transparent 0deg ${start}deg, ${segment.color} ${start + gap}deg ${offset - gap}deg, transparent ${offset}deg 360deg)`
          : null
        const colors = displayed.map(item => ({ ...item, color: item.id === segment.id ? item.color : "transparent" }))
        const texture = displayed.map(item => ({ ...item, color: item.id === segment.id ? "#000" : "transparent" }))
        return <div className={`distributionSegment${segment.selected ? " isSelected" : ""}${popped ? " isActive" : ""}`} data-segment-id={segment.id} key={segment.id || index} style={{ "--distribution-glow-rgb": segment.glowRgb, transform: popped ? `translate(${Math.sin(middle) * 9}px, ${-Math.cos(middle) * 9}px)` : undefined }}>
          <div className="distributionSegmentFill" style={{ background: fill || `conic-gradient(${distributionGradient(colors, displayedTotal)})` }}>
            {animateSelection && <span className="distributionSegmentTexture" style={{ maskImage: `conic-gradient(${distributionGradient(texture, displayedTotal)})`, WebkitMaskImage: `conic-gradient(${distributionGradient(texture, displayedTotal)})` }} />}
          </div>
          {animateSelection && share >= .045 && <span className="distributionPercent" style={{ left: `${50 + Math.sin(middle) * 37}%`, top: `${50 - Math.cos(middle) * 37}%` }}>{(share * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</span>}
        </div>
      })}
      {animateSelection && <span className="distributionValue">{formatValue?.(displayedTotal)}</span>}
      {activeSegment && <span className="distributionTooltip">{activeSegment.title} <strong style={{ color: activeSegment.color }}>{formatValue?.(activeSegment.value)}</strong></span>}
      {children}
    </div>
  }
  return <div className={className} style={{ background: `conic-gradient(${distributionGradient(segments, total)})` }} role="img" aria-label={label}>{children}</div>
}
