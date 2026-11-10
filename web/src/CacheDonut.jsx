import React, { useEffect, useRef, useState } from "react"

const point = (angle, radius) => [100 + Math.sin(angle) * radius, 100 - Math.cos(angle) * radius]
export function cacheSectorPath(start, end, outer = 100, inner = 50, spacing = 2) {
  const span = Math.min(Math.PI * 2 - .00001, Math.max(0, end - start))
  if (span < .00001) return ""
  end = start + span
  const full = span > Math.PI * 2 - .0001
  const outerGap = full ? 0 : Math.min(Math.max(0, spacing) / outer / 2, span / 2)
  const innerGap = full ? 0 : Math.min(Math.max(0, spacing) / inner / 2, span / 2)
  const a = point(start + outerGap, outer), b = point(end - outerGap, outer), c = point(end - innerGap, inner), d = point(start + innerGap, inner)
  return `M${a} A${outer},${outer} 0 ${span - 2 * outerGap > Math.PI ? 1 : 0} 1 ${b} L${c} A${inner},${inner} 0 ${span - 2 * innerGap > Math.PI ? 1 : 0} 0 ${d} Z`
}

// Telegram ListViewAnimation.swift's explicit non-UIKit fallback: (.23, 1, .32, 1).
// Its UIKit spring solver cannot be called by the Web view.
export function telegramChartProgress(progress) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress))
  const coordinate = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
  let low = 0, high = 1
  for (let index = 0; index < 20; index++) {
    const middle = (low + high) / 2
    if (coordinate(middle, .23, .32) < progress) low = middle
    else high = middle
  }
  return coordinate((low + high) / 2, 1, 1)
}

// processChartData: make nonzero slices at least 1%, taking the excess from larger slices.
export function cacheChartShares(segments) {
  const total = segments.reduce((sum, item) => sum + (item.selected ? item.value : 0), 0)
  if (!total) return segments.map(() => 0)
  const shares = segments.map(item => item.selected && item.value > 0 ? Math.max(.01, item.value / total) : 0)
  const sum = shares.reduce((a, b) => a + b, 0)
  const available = shares.reduce((a, b) => a + Math.max(0, b - .01), 0)
  return shares.map(value => available ? value - Math.max(0, value - .01) * (sum - 1) / available : value / sum)
}
const rgb = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))

// Keep each category's identity through interrupted animations and rescans.
function useGeometry(segments, active, hasScanned, cleared) {
  const current = useRef([])
  const total = segments.reduce((sum, item) => sum + (item.selected ? item.value : 0), 0)
  const empty = hasScanned && !total
  const shares = cacheChartShares(segments)
  let angle = 0
  const data = segments.length ? segments : [{ id: "empty", title: "", color: "#e9e9ed", value: 0 }]
  const previousSpans = data.map(item => {
    const previous = current.current.find(old => old.id === item.id)
    return previous ? Math.max(0, previous.end - previous.start) : 0
  })
  const previousSum = previousSpans.reduce((sum, value) => sum + value, 0)
  const target = data.map((item, index) => {
    const share = empty || !hasScanned ? previousSum ? previousSpans[index] / previousSum : 1 / data.length : shares[index]
    const start = angle; angle += share * Math.PI * 2
    return { ...item, start, end: angle, inner: empty ? 45 : 50, outer: empty ? 51 : active && active !== item.id ? 85 : 100,
      rotation: empty ? 180 : 0, offset: empty ? -54 : 0, empty: empty ? 1 : 0,
      colorChannels: rgb(empty ? cleared ? "#30c969" : "#e9e9ed" : item.color), amount: item.selected ? item.value : 0, opacity: share ? 1 : 0 }
  })
  const key = JSON.stringify([segments, active, hasScanned, cleared])
  const [geometry, setGeometry] = useState(target)
  if (!current.current.length) current.current = geometry
  useEffect(() => {
    const from = new Map(current.current.map(item => [item.id, item]))
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target; setGeometry(target); return
    }
    let frame, started
    function step(now) {
      started ??= now
      const progress = Math.min(1, (now - started) / 400)
      const t = telegramChartProgress(progress)
      const next = target.map(item => {
        const old = from.get(item.id) || { ...item, end: item.start, opacity: 0 }
        const lerp = name => old[name] + (item[name] - old[name]) * t
        return { ...item, start: lerp("start"), end: lerp("end"), inner: lerp("inner"), outer: lerp("outer"), opacity: lerp("opacity"), rotation: lerp("rotation"), offset: lerp("offset"), empty: lerp("empty"), amount: lerp("amount"), colorChannels: item.colorChannels.map((channel, index) => old.colorChannels[index] + (channel - old.colorChannels[index]) * t) }
      })
      current.current = next; setGeometry(next)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [key])
  return geometry
}

export default function CacheDonut({ segments, formatValue, label, hasScanned = true, cleared = false }) {
  const [active, setActive] = useState(null)
  const geometry = useGeometry(segments, active, hasScanned, cleared)
  const selectedTotal = segments.reduce((sum, item) => sum + (item.selected ? item.value : 0), 0)
  const inspected = geometry.find(item => item.id === active && item.selected && item.opacity > .5)
  const position = inspected && point((inspected.start + inspected.end) / 2, inspected.outer)
  const emptyProgress = geometry[0]?.empty || 0
  const offset = geometry[0]?.offset || 0
  const displayedTotal = geometry.reduce((sum, item) => sum + item.amount, 0)
  useEffect(() => { if (!segments.some(item => item.id === active && item.selected && item.value > 0)) setActive(null) }, [segments, active])
  return <div className="cacheDonut" aria-label={label}>
    <svg viewBox="0 0 200 200" className="cacheDonutSvg" aria-label="可清理缓存分类" onClick={event => { if (event.target === event.currentTarget) setActive(null) }}>
      {geometry.map(item => {
        const path = cacheSectorPath(item.start, item.end, item.outer, item.inner, 2 * (1 - item.empty))
        const share = (item.end - item.start) / (Math.PI * 2)
        const center = point((item.start + item.end) / 2, (item.inner + item.outer) / 2)
        return <g key={item.id} opacity={item.opacity} transform={`translate(0 ${item.offset}) rotate(${item.rotation} 100 100)`}>
          <path d={path} fill={`rgb(${item.colorChannels.map(Math.round).join(",")})`} data-segment-id={item.id} className={`cacheDonutSector${inspected?.id === item.id ? " isActive" : ""}`} role={item.selected && item.value > 0 ? "button" : undefined} tabIndex={item.selected && item.value > 0 ? 0 : -1} style={{ pointerEvents: item.selected && item.value > 0 ? undefined : "none" }} aria-label={`${item.title} ${formatValue(item.value)}`} aria-pressed={active === item.id} onClick={() => { if (item.selected && item.value > 0) setActive(active === item.id ? null : item.id) }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(active === item.id ? null : item.id) } }} />
          {share >= .045 && <text x={center[0]} y={center[1]} className="cacheDonutPercent" opacity={Math.min(1, (share - .045) / .02) * (1 - item.empty)}>{(selectedTotal ? item.value / selectedTotal * 100 : 0).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</text>}
        </g>
      })}
      {cleared && <path className="cacheDoneCheck" d="m80 100 13 13 28-29" fill="none" stroke="#30c969" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity={emptyProgress} transform={`translate(0 ${offset})`} aria-label="缓存已清理" />}
    </svg>
    <span className="cacheDonutValue" style={{ opacity: 1 - emptyProgress }}>{formatValue(displayedTotal)}</span>
    {inspected && <span className="cacheDonutTooltip" style={{ left: `${Math.max(12, Math.min(88, position[0] / 2))}%`, top: `${position[1] / 2}%` }}><b>{(inspected.value / selectedTotal * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</b> {inspected.title} <strong style={{ color: inspected.color }}>{formatValue(inspected.value)}</strong></span>}
  </div>
}
