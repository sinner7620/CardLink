export interface PluginInkRecord {
  version: 1
  id: string
  noteId: string
  notebookId: string
  createdAt: number
  width: number
  height: number
  background: string
  backgroundHeight?: number
  image: string
  strokes: string
  commentId?: string
  saved?: boolean
}

/** Bound the image and geometry before passing a WebView result to native APIs. */
export function validatePluginInkRecord(value: any, noteId: string, notebookId: string): PluginInkRecord {
  if (!value || value.version !== 1 || value.noteId !== noteId || value.notebookId !== notebookId ||
      !/^[a-z0-9-]+$/.test(value.id) || !Number.isFinite(value.createdAt)) throw new Error('批注身份无效')
  if (![value.width, value.height].every(n => Number.isFinite(n) && n > 0 && n <= 16000) || value.width * value.height > 16000000) throw new Error('批注画布过大')
  for (const key of ['image', 'background']) {
    if (typeof value[key] !== 'string' || value[key].length > 24000000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value[key])) throw new Error('批注图片无效或过大')
  }
  if (typeof value.strokes !== 'string' || value.strokes.length > 12000000) throw new Error('笔画数据过大')
  const ink = JSON.parse(value.strokes)
  if (value.backgroundHeight !== undefined && (!Number.isFinite(value.backgroundHeight) || value.backgroundHeight <= 0 || value.backgroundHeight > 16000)) throw new Error('底图尺寸无效')
  if (!Array.isArray(ink.strokes) || ink.strokes.length > 20000) throw new Error('笔画数据无效')
  if (ink.generator === 'cardlink-842-ink-v2') {
    if (ink.width !== 1000 || value.width !== 1000 || !Array.isArray(ink.styles) || ink.styles.length !== ink.strokes.length ||
        !ink.strokes.every((s: any) => Array.isArray(s) && s.length > 0 && s.every((p: any) =>
          Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[2] >= 0 && p[2] <= 1)) ||
        !ink.styles.every((s: any) => s && typeof s === 'object' && Number.isFinite(s.size) && s.size > 0 &&
          typeof s.pressure === 'boolean' && /^#[0-9a-f]{6}$/i.test(s.color || '') &&
          ['goodnotes-ink-v1', 'goodnotes-ink-v2'].includes(s.engine))) throw new Error('笔画数据无效')
  } else if (!ink.strokes.every((s: any) => Array.isArray(s.points) && s.points.length > 0 && s.points.every((p: any) =>
      [p.x, p.y, p.pressure, p.time].every(Number.isFinite)))) throw new Error('笔画数据无效')
  return value
}

export function pluginInkMarker(id: string): string { return `CardLink 插件批注 ${id}` }

export function pluginInkComment(record: PluginInkRecord): string {
  return `<html><body style="margin:0"><img alt="${pluginInkMarker(record.id)}" src="${record.image}" style="display:block;width:100%;height:auto"></body></html>`
}
