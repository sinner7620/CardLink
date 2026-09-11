// R3：解码逻辑已收敛到 pkdrawing-core，本文件只负责把笔迹渲染成 SVG data URI。
import { Stroke, decodeStrokes, drawingData } from "./pkdrawing-core"
import { encodeBase64Ascii } from "./base64"

export function drawingSvgDataUri(encoded: string): string {
  const strokes: Stroke[] = decodeStrokes(drawingData(encoded))
  if (!strokes.length) throw new Error("empty-drawing")
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  strokes.forEach(stroke => stroke.points.forEach(point => {
    minX = Math.min(minX, point.x - point.width); minY = Math.min(minY, point.y - point.width)
    maxX = Math.max(maxX, point.x + point.width); maxY = Math.max(maxY, point.y + point.width)
  }))
  const padding = 8
  const width = Math.max(1, maxX - minX + padding * 2)
  const height = Math.max(1, maxY - minY + padding * 2)
  const paths = strokes.map(stroke => {
    const path = stroke.points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")
    const lineWidth = Math.max(1, stroke.points.reduce((sum, point) => sum + point.width, 0) / stroke.points.length)
    return `<path d="${path}" fill="none" stroke="${stroke.color}" stroke-width="${lineWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${height.toFixed(1)}" viewBox="${(minX - padding).toFixed(1)} ${(minY - padding).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}"><rect x="${(minX - padding).toFixed(1)}" y="${(minY - padding).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="white"/>${paths}</svg>`
  return `data:image/svg+xml;base64,${encodeBase64Ascii(svg)}`
}
