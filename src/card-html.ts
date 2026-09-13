import { pkDrawingRendererScript } from "./pkdrawing-renderer"
import { hasUnsupportedMarginNoteUrl, renderMarkdown } from "./markdown"
import { noteLinkTarget } from "./safe-note"
import { imageMimeFromBase64 } from "./base64"
import { escapeHtml } from "./html-utils"
import { UI_COLORS } from "./ui-tokens"
import { wireFramePinchZoom } from "./pinch-zoom"
import { mountCardPreview } from "./card-preview"

export { escapeHtml } from "./html-utils"

export type NoteResolver = (noteId: string) => any
export type MediaResolver = (hash: string) => string | undefined
export type DrawingResolver = (hash: string) => string | undefined

function arrayOf<T>(value: unknown): T[] {
  try {
    return value ? Array.from(value as ArrayLike<T>) : []
  } catch {
    return []
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function imageBlock(paint: unknown, resolveMedia: MediaResolver): string {
  const hash = textOf(paint)
  if (!hash) return ""
  const base64 = resolveMedia(hash)
  return base64
    ? `<figure><img data-media-id="${escapeHtml(hash)}" src="data:${imageMimeFromBase64(base64)};base64,${base64}" /></figure>`
    : '<div class="missing-image">图片资源不可用</div>'
}

function drawingBlock(drawing: unknown, resolveDrawing: DrawingResolver): string {
  const hash = textOf(drawing)
  if (!hash) return ""
  const base64 = resolveDrawing(hash)
  return base64
    ? `<figure class="drawing"><canvas data-drawing-id="${escapeHtml(hash)}" data-drawing="${base64}"></canvas></figure>`
    : '<div class="missing-image">未读取到手写数据</div>'
}

function paintNoteBlock(
  paint: unknown,
  drawing: unknown,
  resolveMedia: MediaResolver,
  resolveDrawing: DrawingResolver
): string {
  const paintHash = textOf(paint)
  const drawingHash = textOf(drawing)
  if (!paintHash) return drawingBlock(drawingHash, resolveDrawing)
  if (!drawingHash) return imageBlock(paintHash, resolveMedia)

  const imageBase64 = resolveMedia(paintHash)
  const drawingBase64 = resolveDrawing(drawingHash)
  if (imageBase64 && drawingBase64) {
    return `<figure class="paint-note"><img data-media-id="${escapeHtml(paintHash)}" src="data:${imageMimeFromBase64(imageBase64)};base64,${imageBase64}" /><canvas data-drawing-id="${escapeHtml(drawingHash)}" data-drawing="${drawingBase64}" data-drawing-overlay="true"></canvas></figure>`
  }
  if (imageBase64) return `<figure><img data-media-id="${escapeHtml(paintHash)}" src="data:${imageMimeFromBase64(imageBase64)};base64,${imageBase64}" /></figure>`
  if (drawingBase64) {
    return `<figure class="drawing"><canvas data-drawing-id="${escapeHtml(drawingHash)}" data-drawing="${drawingBase64}"></canvas></figure>`
  }
  return '<div class="missing-image">图片及手写资源不可用</div>'
}

function excerptBlock(note: any, resolveMedia: MediaResolver, resolveDrawing: DrawingResolver): string {
  const excerptText = textOf(note?.excerptText)
  const image = paintNoteBlock(note?.excerptPic?.paint, note?.excerptPic?.drawing, resolveMedia, resolveDrawing)
  if (image) return image
  return excerptText ? `<div class="text-block markdown-body">${renderMarkdown(excerptText, resolveMedia)}</div>` : ""
}

function noteBody(
  note: any,
  resolveNote: NoteResolver,
  resolveMedia: MediaResolver,
  resolveDrawing: DrawingResolver,
  visited = new Set<any>()
): string {
  const noteId = textOf(note?.noteId)
  if (!note || visited.has(note) || (noteId && visited.has(noteId))) return ""
  visited.add(note)
  if (noteId) visited.add(noteId)
  const blocks: string[] = []
  const excerpt = excerptBlock(note, resolveMedia, resolveDrawing)
  if (excerpt) blocks.push(excerpt)

  for (const comment of arrayOf<any>(note?.comments)) {
    const type = String(comment?.type ?? "")
    const text = textOf(comment?.text)
    if (type === "PaintNote") {
      const content = paintNoteBlock(
        comment?.paint,
        comment?.drawing,
        resolveMedia,
        resolveDrawing
      )
      if (content) blocks.push(content)
    } else if (type === "HtmlNote" && !text.startsWith("#")) {
      const html = textOf(comment?.html)
      if (html || text) blocks.push(`<div class="html-block">${html || escapeHtml(text)}</div>`)
    } else if (type === "TextNote" && text && !text.startsWith("#")) {
      const linkedId = noteLinkTarget(text)
      if (linkedId) {
        // MN4 note links are plain TextNote comments; render the linked note's
        // content instead of dropping it (same fallback chain as LinkNote).
        const linked = resolveNote(linkedId)
        if (linked && !visited.has(linked)) {
          const linkedBody = noteBody(linked, resolveNote, resolveMedia, resolveDrawing, visited)
          if (linkedBody) blocks.push(linkedBody)
        }
      } else if (!hasUnsupportedMarginNoteUrl(text)) {
        blocks.push(`<div class="text-block markdown-body">${renderMarkdown(text, resolveMedia)}</div>`)
      }
    } else if (type === "LinkNote") {
      const mergedBlocks: string[] = []
      const mergedImage = paintNoteBlock(
        comment?.q_hpic?.paint,
        comment?.q_hpic?.drawing,
        resolveMedia,
        resolveDrawing
      )
      const mergedText = textOf(comment?.q_htext)
      if (mergedImage) mergedBlocks.push(mergedImage)
      if (!mergedImage && mergedText) {
        mergedBlocks.push(`<div class="text-block markdown-body">${renderMarkdown(mergedText, resolveMedia)}</div>`)
      }

      // Older cards may not carry q_htext/q_hpic. Only then fall back to resolving noteid.
      if (!mergedBlocks.length) {
        const linked = resolveNote(textOf(comment?.noteid))
        if (linked && !visited.has(linked)) {
          const linkedBody = noteBody(linked, resolveNote, resolveMedia, resolveDrawing, visited)
          if (linkedBody) mergedBlocks.push(linkedBody)
        }
      }
      if (mergedBlocks.length) blocks.push(mergedBlocks.join(""))
    }
  }
  return blocks.join("")
}

// 统一控制器由各宿主复用，不再二次安装手势。
const cardPinchZoomScript = `(${mountCardPreview.toString()})(window, ${wireFramePinchZoom.toString()});`

export function renderCardHtml(
  note: any,
  questionTitle: string,
  resolveNote: NoteResolver,
  resolveMedia: MediaResolver,
  resolveDrawing: DrawingResolver = resolveMedia
): string {
  const answerTitle = textOf(note?.noteTitle) || "答案卡片"
  const main = noteBody(note, resolveNote, resolveMedia, resolveDrawing)
  const children = arrayOf<any>(note?.childNotes)
    .filter(Boolean)
    .map(child => {
      const title = textOf(child?.noteTitle) || "子卡片"
      return `<section class="child"><h2>${escapeHtml(title)}</h2>${noteBody(
        child,
        resolveNote,
        resolveMedia,
        resolveDrawing,
        new Set<any>()
      )}</section>`
    })
    .join("")

  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes">
<style>
:root{color-scheme:light;--mn-accent:${UI_COLORS.accent};--mn-gray-fill:${UI_COLORS.grayFill};--mn-level-0:${UI_COLORS.level0};--mn-level-1:${UI_COLORS.level1};--mn-level-2:${UI_COLORS.level2}}*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#202124}body{padding:0}.card{min-height:100vh;background:#fff;padding:54px 22px 34px}.eyebrow{font-size:12px;color:#6b7280;margin-bottom:6px}.card h1{font-size:22px;line-height:1.35;margin:0 44px 18px 0}.text-block,.html-block{font-size:16px;line-height:1.7;word-break:break-word;margin:12px 0;padding:12px 14px;background:#f5f7fb;border-radius:9px}.html-block{white-space:normal}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body pre{margin:8px 0}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{line-height:1.35;margin:16px 0 8px}.markdown-body h1{font-size:1.45em}.markdown-body h2{font-size:1.3em}.markdown-body h3{font-size:1.16em}.markdown-body ul,.markdown-body ol{padding-left:1.6em}.markdown-body blockquote{margin-left:0;padding-left:12px;border-left:3px solid #9ca3af;color:#4b5563}.markdown-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;padding:.12em .3em;background:rgba(127,127,127,.14);border-radius:4px}.markdown-body pre{overflow:auto;padding:10px 12px;background:rgba(127,127,127,.14);border-radius:7px;white-space:pre}.markdown-body pre code{padding:0;background:none}.markdown-body table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.markdown-body th,.markdown-body td{padding:5px 9px;border:1px solid #c9ced8}.markdown-body a{color:var(--mn-accent)}.markdown-body .katex-display{display:block;margin:12px 0;overflow-x:auto;overflow-y:hidden;text-align:center}.markdown-body math{font-size:1.08em}figure{margin:14px 0;text-align:center}img,canvas[data-drawing]{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:8px}canvas[data-drawing]{background:#fff}.paint-note{position:relative;display:block}.paint-note img{width:100%;height:auto}.paint-note canvas[data-drawing]{position:absolute;inset:0;width:100%;height:100%;margin:0;background:transparent;pointer-events:none}.missing-image{padding:28px;text-align:center;color:#9b1c1c;background:#fff1f1;border-radius:8px}.child{margin-top:20px;padding-top:16px;border-top:1px solid #d9dde7}.child h2{font-size:17px;margin:0 0 10px}
</style></head><body><article class="card"><div class="eyebrow">${escapeHtml(
    questionTitle
  )}</div><h1>${escapeHtml(answerTitle)}</h1>${main}${children}</article><script>${pkDrawingRendererScript}</script><script>${cardPinchZoomScript}</script></body></html>`
}
