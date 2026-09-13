import { MN, isNSNull } from "marginnote"

type BoundMindMapHandwritingAsset = { hash: string; base64: string; kind: "drawing" | "image"; mime?: string }

function rasterMime(base64: string): string | undefined {
  if (base64.startsWith("iVBOR")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("R0lGOD")) return "image/gif"
  if (base64.startsWith("UklGR")) return "image/webp"
  return undefined
}

function sketchMediaHashes(note: any): string[] {
  const hashes: string[] = []
  const append = (value: any) => {
    const hash = String(value ?? "").trim()
    if (hash && !hashes.includes(hash)) hashes.push(hash)
  }
  append(note?.drawing)
  append(note?.excerptPic?.drawing)
  for (const comment of Array.from(note?.comments ?? []) as any[]) {
    append(comment?.drawing)
    append(comment?.q_hpic?.drawing)
  }
  for (const hash of String(note?.mediaList ?? "").split("-")) append(hash)
  append(note?.paint)
  append(note?.excerptPic?.paint)
  for (const comment of Array.from(note?.comments ?? []) as any[]) {
    append(comment?.paint)
    append(comment?.q_hpic?.paint)
  }
  return hashes
}

/**
 * 官方 JSBMbModelTool 暴露按焦点卡片读取脑图草稿的接口，但 marginnote npm
 * 的类型声明暂未包含该单数方法，因此在运行时做能力探测，并把不可用视为无附件。
 */
export function readBoundMindMapHandwriting(notebookId: string, noteId: string): { status: "included" | "none" | "unsupported" | "unreadable"; assets: BoundMindMapHandwritingAsset[] } {
  try {
    const db: any = MN.db as any
    const readSketch = db?.getSketchNoteForMindMapFocusNoteId
    if (typeof readSketch !== "function") return { status: "unsupported", assets: [] }
    const sketch = readSketch.call(db, notebookId, noteId)
    if (sketch == null || isNSNull(sketch)) return { status: "none", assets: [] }
    const assets: BoundMindMapHandwritingAsset[] = []
    for (const hash of sketchMediaHashes(sketch)) {
      try {
        const value = db.getMediaByHash(hash)?.base64Encoding?.()
        const base64 = String(value ?? "").replace(/\s/g, "")
        if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) continue
        const mime = rasterMime(base64)
        assets.push(mime ? { hash, base64, kind: "image", mime } : { hash, base64, kind: "drawing" })
      } catch {}
    }
    const drawings = assets.filter(asset => asset.kind === "drawing")
    const selected = drawings.length ? drawings : assets
    return selected.length ? { status: "included", assets: selected } : { status: "unreadable", assets: [] }
  } catch {
    return { status: "unreadable", assets: [] }
  }
}

export function appendBoundMindMapHandwriting(questionHtml: string, result: ReturnType<typeof readBoundMindMapHandwriting>, interactive = false): string {
  if (!result.assets.length && !interactive) return questionHtml
  const items = result.assets.map((asset, index) => asset.kind === "image"
    ? `<figure class="bound-mindmap-handwriting-item"><img src="data:${asset.mime};base64,${asset.base64}" alt="脑图绑定手写 ${index + 1}" /></figure>`
    : `<figure class="drawing bound-mindmap-handwriting-item"><canvas data-drawing-id="mindmap-${asset.hash}" data-drawing="${asset.base64}"></canvas></figure>`).join("")
  const section = `<style>.bound-mindmap-handwriting{margin-top:20px;padding-top:16px;border-top:1px solid #d9dde7}.bound-mindmap-handwriting>h2{margin:0 0 10px;font-size:14px;color:#6b7280}.bound-mindmap-handwriting-item{margin:8px 0}</style><section class="bound-mindmap-handwriting" aria-label="脑图绑定手写"><h2>脑图绑定手写</h2>${items}</section>`
  const message = result.status === "none" ? "该卡片没有绑定手写" : result.status === "unsupported" ? "当前 MarginNote 版本不支持读取绑定手写" : "绑定手写暂时无法读取"
  const content = interactive
    ? `<style>[data-bound-handwriting][hidden]{display:none!important}</style><div data-bound-handwriting hidden>${result.assets.length ? section : `<p>${message}</p>`}</div>`
    : section
  if (questionHtml.includes("</article>")) return questionHtml.replace("</article>", `${content}</article>`)
  return questionHtml.replace("</body>", `${content}</body>`)
}
