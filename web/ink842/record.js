import { PAGE_WIDTH } from './ink-geometry.js'
import { FEEL_CONTROLS } from './ink-settings.js'

export const INK_GENERATOR = 'cardlink-842-ink-v2'

/** Restore both the website point/style format and previously delivered InkCanvas records. */
export function restoreInkAnswer(record) {
  const data = JSON.parse(record.strokes)
  if (data.generator === INK_GENERATOR) return { height: record.height, strokes: data.strokes, styles: data.styles }
  const scale = PAGE_WIDTH / record.width
  const styles = [], strokes = data.strokes.map(stroke => {
    const o = stroke.options, start = stroke.points[0]?.time || 0
    styles.push({ engine: 'goodnotes-ink-v2', penType: o.penType === 'highlighter' ? 'fountain' : o.penType || 'fountain',
      kind: o.penType === 'highlighter' ? 'marker' : 'pen', size: o.size, color: o.color || '#1c2933',
      pressure: o.pressureSensitivity > 0, inputScale: 1 / scale,
      feel: Object.fromEntries(FEEL_CONTROLS.map(([key]) => [key, o[key]])), legacyOptions: { ...o } })
    return stroke.points.map(p => [p.x * scale, p.y * scale, p.pressure, Math.max(0, p.time - start)])
  })
  return { height: Math.ceil(record.height * scale), strokes, styles }
}

export function serializeInkAnswer(answer) {
  return JSON.stringify({ generator: INK_GENERATOR, width: PAGE_WIDTH, strokes: answer.strokes, styles: answer.styles })
}
