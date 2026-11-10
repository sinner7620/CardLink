import katex from "katex"
import { MN, delay, saveFile, showHUD, writeTextFile } from "marginnote"
import { cardLinkDocumentPath } from "./storage-paths"
import { LEVEL_DESCRIPTIONS, MistakeHistoryItem, MistakeRecord } from "./mistake-domain"
import { mistakeDetailById, mistakeWorkbenchData } from "./mistake-manager"
import { cardHtmlToMarkdown } from "./card-markdown"
import { escapeHtml } from "./html-utils"
import { pkDrawingRendererScript } from "./pkdrawing-renderer"
import { recordRuntimeState, captureDiagnosticError } from "./note-navigation"
import { decodeBase64Ascii, imagePixelWidth } from "./base64"

export interface MistakeExportOptions {
  recordIds?: string[]
  format: "md" | "pdf"
  filename?: string
  answerLayout?: "after-each" | "end"
  pageLayout?: "auto" | "one-per-page" | "two-per-page" | "three-per-page"
  reviewDetail?: "summary" | "full"
  previewLimit?: number
  include?: {
    question?: boolean
    answer?: boolean
    source?: boolean
    review?: boolean
    handwriting?: boolean
    comments?: boolean
  }
}

interface ExportDetail {
  record: MistakeRecord & { categoryLabel?: string }
  questionHtml: string
  answers: Array<{ title: string; path: string; html: string }>
  answerStatus: string
}

// escapeHtml 统一使用 html-utils 的单一实现。

// 导出准备阶段取消标志：停止按钮在 PDF 任务受理或 MD 落盘完成前点击时，
// 前端经 cancelMistakeExportPreparation 置位，selectedDetails/资产写入循环内检查。
interface PreparationContext { cancelled: boolean; running: boolean; progress: { prepared: number; total: number } }
let activePreparation: PreparationContext = { cancelled: false, running: false, progress: { prepared: 0, total: 0 } }

export function mistakeExportPreparationStatus(): { prepared: number; total: number } {
  return { ...activePreparation.progress }
}

export function cancelMistakeExportPreparation(): void {
  activePreparation.cancelled = true
}

function ensureNotCancelled(context = activePreparation): void {
  if (context.cancelled) throw new Error("已取消导出")
}

function cleanFilename(value: unknown, extension: string): string {
  const base = String(value || `MN4错题导出-${new Date().toISOString().slice(0, 10)}`)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\.(md|pdf)$/i, "")
    .trim()
    .slice(0, 80) || "MN4错题导出"
  return `${base}.${extension}`
}

interface MarkdownAsset {
  fileName: string
  base64?: string
  mediaId?: string
  utf8?: string
}

export function extractMarkdownAssets(markdown: string): { markdown: string; assets: MarkdownAsset[] } {
  const assets: MarkdownAsset[] = []
  const sizedImages: string[] = []
  let output = String(markdown || "").replace(/<img\b[^>]*>/gi, tag => {
    const source = tag.match(/\bsrc=["']([^"']*)["']/i)?.[1]
    if (!source) return tag
    const index = sizedImages.push(tag) - 1
    return `![CARDLINKSIZEDASSET${index}TOKEN](${source})`
  }).replace(
    /!\[([^\]]*)\]\(marginnote4app:\/\/markdownimg\/(png|jpe?g|gif|webp)\/([^)]+)\)/gi,
    (_, alt: string, rawExtension: string, mediaId: string) => {
      const extension = rawExtension.toLowerCase().replace("jpeg", "jpg")
      const fileName = `asset-${String(assets.length + 1).padStart(4, "0")}.${extension}`
      let decodedMediaId = mediaId
      try { decodedMediaId = decodeURIComponent(mediaId) } catch { /* 保留原始哈希 */ }
      assets.push({ fileName, mediaId: decodedMediaId })
      return `![${alt}](assets/${fileName})`
    }
  )
  output = output.replace(
    /!\[([^\]]*)\]\(mnmedia:\/\/(png|jpg|gif|webp)\/([^)]+)\)/g,
    (_, alt: string, extension: string, mediaId: string) => {
      const fileName = `asset-${String(assets.length + 1).padStart(4, "0")}.${extension}`
      assets.push({ fileName, mediaId: decodeURIComponent(mediaId) })
      return `![${alt}](assets/${fileName})`
    }
  )
  output = output.replace(
    /!\[([^\]]*)\]\(data:image\/(png|jpeg|jpg|svg\+xml);base64,([A-Za-z0-9+/=\s]+)\)/g,
    (_, alt: string, rawType: string, base64: string) => {
      const type = rawType.toLowerCase()
      const compact = base64.replace(/\s/g, "")
      const extension = compact.startsWith("iVBOR") ? "png"
        : compact.startsWith("/9j/") ? "jpg"
          : compact.startsWith("PHN2Zy") ? "svg"
            : type === "svg+xml" ? "svg" : type === "jpeg" ? "jpg" : type
      const fileName = `asset-${String(assets.length + 1).padStart(4, "0")}.${extension}`
      assets.push(extension === "svg"
        ? { fileName, utf8: decodeBase64Ascii(compact) }
        : { fileName, base64: compact })
      return `![${alt}](assets/${fileName})`
    }
  )
  output = output.replace(/!\[CARDLINKSIZEDASSET(\d+)TOKEN\]\(([^)]+)\)/g, (_, index, source) =>
    sizedImages[Number(index)].replace(/\bsrc=["'][^"']*["']/i, `src="${escapeHtml(source)}"`))
  return { markdown: output, assets }
}

function fallbackBase64Data(base64: string): any {
  const dataClass = NSData as any
  if (typeof dataClass.dataWithBase64EncodedStringOptions === "function") {
    return dataClass.dataWithBase64EncodedStringOptions(base64, 0)
  }
  if (typeof dataClass.alloc === "function") {
    const instance = dataClass.alloc()
    if (typeof instance?.initWithBase64EncodedStringOptions === "function") {
      return instance.initWithBase64EncodedStringOptions(base64, 0)
    }
  }
  throw new Error("HTML 评论中的内嵌图片无法解码；普通卡片图片不受影响")
}

function ensureDirectory(path: string): void {
  const manager = NSFileManager.defaultManager() as any
  if (manager.fileExistsAtPath(path)) return
  if (!manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(path, true, null)) {
    throw new Error(`无法创建导出目录：${path}`)
  }
}

/**
 * 导出产物目录保留最近 KEEP_EXPORTS 份（含 zip 与目录对），更旧的自动删除。
 * 此前 exports/<时间戳>/ 无限累积。
 */
const KEEP_EXPORTS = 5

function cleanupOldExports(): void {
  try {
    const manager = NSFileManager.defaultManager() as any
    const root = cardLinkDocumentPath("exports")
    const entries = (manager.contentsOfDirectoryAtPathError(root, null) ?? []) as any[]
    // 目录与同名 zip 归为同一次导出（key 去掉 .zip），按批次计数而不是按条目。
    const items = entries
      .map(name => String(name))
      .map(name => ({ name, stamp: (name.match(/(\d{14,17})/) || [])[1] || "", key: name.replace(/\.zip$/i, "") }))
      .filter((item): item is { name: string; stamp: string; key: string } => Boolean(item.stamp))
      .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.key.localeCompare(a.key))
    const keptGroups = new Set<string>()
    for (const item of items) {
      if (keptGroups.size < KEEP_EXPORTS) {
        keptGroups.add(item.key)
        continue
      }
      if (keptGroups.has(item.key)) continue
      manager.removeItemAtPathError(`${root}/${item.name}`, null)
    }
  } catch {
    // 清理失败不影响导出
  }
}

// 目录名精确到毫秒：同秒连续导出不再复用目录与 zip 路径。
function exportStamp(): string {
  const now = new Date()
  const part = (value: number, width = 2) => String(value).padStart(width, "0")
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}${part(now.getMilliseconds(), 3)}`
}

async function saveMarkdownBundle(markdown: string, requestedName: unknown): Promise<{ filename: string; assetCount: number }> {
  const context = activePreparation
  const mdFilename = cleanFilename(requestedName, "md")
  const baseName = mdFilename.replace(/\.md$/i, "")
  const stamp = exportStamp()
  const exportRoot = `${cardLinkDocumentPath("exports")}/${baseName}-${stamp}`
  const assetRoot = `${exportRoot}/assets`
  ensureDirectory(assetRoot)
  const bundle = extractMarkdownAssets(markdown)
  for (const [index, asset] of bundle.assets.entries()) {
    const data = asset.mediaId
      ? MN.db.getMediaByHash(asset.mediaId)
      : asset.utf8 !== undefined
        ? NSData.dataWithStringEncoding(asset.utf8, 4)
        : fallbackBase64Data(asset.base64 || "")
    if (!data?.length() || !data.writeToFileAtomically(`${assetRoot}/${asset.fileName}`, true)) {
      throw new Error(`导出图片失败：${asset.fileName}`)
    }
    // 图片写入分段让路：停止按钮可点、取消标志可送达。
    if (index % 8 === 7 && index + 1 < bundle.assets.length) {
      await delay(0.01)
      ensureNotCancelled(context)
    }
  }
  ensureNotCancelled(context)
  writeTextFile(`${exportRoot}/${mdFilename}`, `\uFEFF${bundle.markdown}`)
  const zipFilename = `${baseName}.zip`
  const zipPath = `${cardLinkDocumentPath("exports")}/${baseName}-${stamp}.zip`
  if (!ZipArchive.createZipFileAtPathWithContentsOfDirectory(zipPath, exportRoot)) {
    throw new Error("Markdown 压缩包生成失败")
  }
  saveFile(zipPath, "public.zip-archive")
  cleanupOldExports()
  return { filename: zipFilename, assetCount: bundle.assets.length }
}

function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
}

function bodyOf(documentHtml: string): string {
  const match = String(documentHtml || "").match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  return match ? match[1] : String(documentHtml || "")
}

function formatDate(value?: string): string {
  if (!value) return "无"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function sourceText(record: MistakeRecord): string {
  // 隐私：MD 导出不再携带原卡片/原脑图内部 ID（与 PDF 的来源小字语义对齐）
  const path = [record.sourceNotebookTitle, ...(record.sourcePathTitles || [])].filter(Boolean).join(" > ")
  return path || "未命名脑图"
}

function historyMarkdown(history: MistakeHistoryItem[]): string {
  if (!history?.length) return "暂无复习记录"
  return history.map(item => `- ${formatDate(item.at)}：${LEVEL_DESCRIPTIONS[item.level]}`).join("\n")
}

interface PdfAssetScript { name: string; path: string }
interface PdfUnit { name: string; kind: "question" | "answer"; index: number; title: string }

/** Keep base64 intact in UTF-8 scripts; do not round-trip binary through JS strings. */
function pdfAssetStager(directory?: string) {
  const context = activePreparation
  const root = directory || `${cardLinkDocumentPath("exports")}/pdf-assets-${exportStamp()}`
  ensureDirectory(root)
  const assets: PdfAssetScript[] = []
  const references = new Map<string, string>()
  const save = (kind: "image" | "drawing", identity: string | undefined, value: string): string => {
    const key = identity ? `${kind}:${identity}` : ""
    const existing = key ? references.get(key) : undefined
    if (existing) return existing
    ensureNotCancelled(context)
    const id = `${kind}-${assets.length + 1}`
    const name = `${id}.js`
    const path = `${root}/${name}`
    const selector = kind === "image" ? `img[data-pdf-image-id="${id}"]` : `canvas[data-pdf-drawing-id="${id}"]`
    const assign = kind === "image" ? `items[i].src=${JSON.stringify(value)}` : `items[i].setAttribute('data-drawing',${JSON.stringify(value)})`
    writeTextFile(path, `(function(){var items=document.querySelectorAll('${selector}');for(var i=0;i<items.length;i++)${assign};})();`)
    if (!NSFileManager.defaultManager().fileExistsAtPath(path)) throw new Error("PDF 图片或手写资源暂存失败")
    assets.push({ name, path })
    if (key) references.set(key, id)
    return id
  }
  const stage = (html: string) => {
    const scaleSources = new Set(Array.from(html.replace(/<section\b[^>]*class=["'][^"']*\bbound-mindmap-handwriting\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "").matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), match => match[1]))
    return html.replace(/<img\b[^>]*>/gi, tag => {
    const source = tag.match(/\bsrc=["'](data:image\/[^;]+;base64,[^"']+)["']/i)
    if (!source) return tag
    const mediaId = tag.match(/\bdata-media-id=["']([^"']+)["']/i)?.[1]
    const id = save("image", mediaId, source[1])
    if (scaleSources.has(source[1])) {
    }
    return tag.replace(source[0], `data-pdf-image-id="${id}"`)
  }).replace(/<canvas\b[^>]*>/gi, tag => {
    const source = tag.match(/\bdata-drawing=["']([^"']+)["']/i)
    if (!source) return tag
    const drawingId = tag.match(/\bdata-drawing-id=["']([^"']+)["']/i)?.[1]
    return tag.replace(source[0], `data-pdf-drawing-id="${save("drawing", drawingId, source[1])}"`)
  })
  }
  return { stage, assets, root }
}

async function selectedDetails(options: MistakeExportOptions, detailLimit = 0, consume?: (detail: ExportDetail, index: number) => void, directory?: string) {
  // 契约（显式区分）：recordIds 未提供 = 不限（导出全部）；recordIds 为数组
  // （含空数组）= 严格白名单，空数组即"零道"——绝不让"没有选中"变成"导出全部"。
  const allowAll = !Array.isArray(options.recordIds)
  const allowed = new Set((options.recordIds || []).map(String))
  const workbench = mistakeWorkbenchData()
  const byId = new Map(workbench.records.map(record => [record.recordId, record]))
  const candidates = allowAll ? workbench.records : [...allowed].flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  // 被请求但不可用的记录数量，避免静默过滤。
  let missing = allowAll
    ? candidates.filter(record => !record.noteAvailable).length
    : candidates.filter(record => !record.noteAvailable).length + (allowed.size - candidates.length)
  const available = candidates.filter(record => record.noteAvailable)
  const detailRecords = detailLimit > 0 ? available.slice(0, detailLimit) : available
  const initialMissing = missing
  const context = activePreparation
  context.progress = { prepared: 0, total: detailRecords.length }
  const details: ExportDetail[] = []
  let consumed = 0
  const stager = options.format === "pdf" ? pdfAssetStager(directory) : { stage: (html: string) => html, assets: [] as PdfAssetScript[] }
  const stage = stager.stage
  for (const [index, record] of detailRecords.entries()) {
    ensureNotCancelled(context)
    let detail: ReturnType<typeof mistakeDetailById> | undefined
    try {
      detail = mistakeDetailById(record.recordId, options.include?.answer === false ? "question" : options.include?.question === false ? "answers" : "all", true, {
        handwriting: options.include?.handwriting === true,
        comments: options.include?.comments === true
      })
    } catch (error) {
      missing++
      captureDiagnosticError(error, "导出卡片")
    }
    if (detail) {
      detail.questionHtml = stage(stripScripts(detail.questionHtml))
      detail.answers = detail.answers.map(answer => ({ ...answer, html: stage(stripScripts(answer.html)) }))
      // Staging/cancellation failures must abort, never masquerade as an unavailable card.
      if (consume) { consume(detail, consumed); consumed++ }
      else details.push(detail)
      recordRuntimeState("导出", "question.prepared", `record=${record.recordId} candidates=${detail.answers.length} unique=${new Set(detail.answers.map(answer => answer.id)).size}`)
    }
    context.progress.prepared = index + 1
    // 大批量导出分批让路，避免主线程长时间冻结；让路点同时是取消检查点。
    if (index % 4 === 3 && index + 1 < detailRecords.length) {
      await delay(0.01)
      ensureNotCancelled(context)
    }
  }
  ensureNotCancelled(context)
  return { details, missing, total: available.length - (missing - initialMissing), pdfAssets: stager.assets, count: consume ? consumed : details.length }
}

export function buildMistakeMarkdown(details: ExportDetail[], options: MistakeExportOptions): string {
  const include = { question: true, answer: true, source: true, review: true, ...options.include }
  // 一批图片共用一个比例，短截图不再单独撑满整列。
  const widths = new Map<string, number>()
  for (const detail of details) {
    const documents = [...(include.question ? [detail.questionHtml] : []), ...(include.answer ? detail.answers.map(answer => answer.html) : [])]
    for (const html of documents) {
      const content = html.replace(/<section\b[^>]*class=["'][^"']*\bbound-mindmap-handwriting\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
      for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        if (widths.has(match[1])) continue
        const width = imagePixelWidth(match[1])
        if (width) widths.set(match[1], width)
      }
    }
  }
  const referenceWidth = Math.max(1, ...widths.values())
  // 186mm 内容列约 703 CSS px；自动布局使用其中 60%。
  const targetWidth = options.pageLayout && options.pageLayout !== "auto" ? 703 : 422
  const scale = Math.min(1, targetWidth / referenceWidth)
  const imageWidth = (source: string) => widths.has(source) ? Math.max(1, Math.round(widths.get(source)! * scale)) : undefined
  const lines = [
    "# MN4 错题导出",
    "",
    `> 导出时间：${formatDate(new Date().toISOString())} · 共 ${details.length} 道错题`,
    ""
  ]
  details.forEach((detail, index) => {
    const record = detail.record
    lines.push(`${index + 1}. [${record.sourceTitle}](#错题-${index + 1})`)
  })
  for (const [index, detail] of details.entries()) {
    const record = detail.record
    lines.push("", "---", "", `<a id=\"错题-${index + 1}\"></a>`, `## ${index + 1}. ${record.sourceTitle}`, "")
    lines.push(`**${LEVEL_DESCRIPTIONS[record.level]}**　｜　分类：${record.categoryLabel || "未分类"}`)
    if (include.source) lines.push("", "### 来源", "", sourceText(record))
    if (include.question) lines.push("", "### 原题卡片", "", cardHtmlToMarkdown(detail.questionHtml, 4, imageWidth))
    if (include.answer) {
      lines.push("", "### 实时匹配答案", "")
      if (detail.answers.length) {
        detail.answers.forEach((answer, answerIndex) => {
          if (detail.answers.length > 1) lines.push(`#### 答案${index + 1}.${answerIndex + 1}：${answer.title}`, "", answer.path || "")
          lines.push(cardHtmlToMarkdown(answer.html, 4, imageWidth), "")
        })
      } else {
        lines.push(`> ${detail.answerStatus === "unbound" ? "原题脑图尚未绑定答案脑图" : "当前未匹配到答案"}`)
      }
    }
    if (include.review) {
      lines.push("", "### 复习记录", "", `- 加入时间：${formatDate(record.createdAt)}`, `- 最近复习：${formatDate(record.lastReviewedAt)}`, `- 下次复习：${formatDate(record.nextReviewAt)}`, `- 完成次数：${record.reviewCount}`)
      if (options.reviewDetail === "full") lines.push("", historyMarkdown(record.history))
    }
  }
  return `${lines.join("\n")}\n`
}

function pdfCardBody(documentHtml: string): string {
  return stripScripts(bodyOf(documentHtml))
    .replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, math => {
      const source = math.match(/<annotation\b[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i)?.[1]
      if (!source) throw new Error("PDF 公式缺少 TeX 源码，无法可靠绘制；请将公式转换为带源码的公式或图片")
      const tex = source.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
      return katex.renderToString(tex, { output: "html", displayMode: /display=["']block["']/.test(math), throwOnError: true, trust: false })
    })
    .replace(/<details\b([^>]*)>/gi, "<details$1 open>")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>\s*/gi, "")
    .replace(/<iframe\b[^>]*\/?>(?:\s*)/gi, "")
    .replace(/<div\s+class=["']eyebrow["'][^>]*>[\s\S]*?<\/div>\s*/i, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "")
}

function pdfSourceLine(record: MistakeRecord): string {
  return [record.sourceNotebookTitle, ...(record.sourcePathTitles || [])].filter(Boolean).join(" › ") || "未命名脑图"
}

export function buildMistakePdfHtml(details: ExportDetail[], options: MistakeExportOptions, assets: PdfAssetScript[] = [], indexOffset = 0): string {
  const include = { question: true, answer: true, source: true, review: true, ...options.include }
  const questionBlock = (detail: ExportDetail, index: number) => {
    index += indexOffset
    const record = detail.record
    const source = include.source ? `<small class="problem-source">来源：${escapeHtml(pdfSourceLine(record))}</small>` : ""
    const question = include.question ? `<section class="card-content">${pdfCardBody(detail.questionHtml)}</section>` : ""
    const history = include.review && options.reviewDetail === "full" ? `<ul class="review-history">${(record.history || []).map(item => `<li>${escapeHtml(formatDate(item.at))}：${escapeHtml(LEVEL_DESCRIPTIONS[item.level])}</li>`).join("") || "暂无复习记录"}</ul>` : ""
    const review = include.review ? `<small class="review-meta">${escapeHtml(LEVEL_DESCRIPTIONS[record.level])}　加入 ${escapeHtml(formatDate(record.createdAt))}　${record.reviewCompleted ? "已结束" : `下次 ${escapeHtml(formatDate(record.nextReviewAt))}`}</small>` : ""
    return `<article class="mistake question-unit"><header class="problem-title"><span>${index + 1}.</span><h1>${escapeHtml(record.sourceTitle)}</h1></header>${source}${question}<div class="writing-space" aria-hidden="true"></div>${review}${history}</article>`
  }
  const answerBlock = (detail: ExportDetail, index: number) => {
    index += indexOffset
    const record = detail.record
    const answerCards = detail.answers.length
      ? detail.answers.map((answer, answerIndex) => `<section class="answer-card">${detail.answers.length > 1 ? `<h2>答案${index + 1}.${answerIndex + 1} · ${escapeHtml(answer.title)}</h2>` : ""}${answer.path ? `<small>${escapeHtml(answer.path)}</small>` : ""}${pdfCardBody(answer.html)}</section>`).join("")
      : `<p class="notice">${detail.answerStatus === "unbound" ? "原题脑图尚未绑定答案脑图" : "当前未匹配到答案"}</p>`
    return `<article class="mistake answer-unit"><header class="problem-title"><span>答案 ${index + 1}</span><h1>${escapeHtml(record.sourceTitle)}</h1></header>${include.source ? `<small class="problem-source">来源：${escapeHtml(pdfSourceLine(record))}</small>` : ""}<section class="answer-content">${answerCards}</section></article>`
  }
  const questionBlocks = details.map(questionBlock)
  const answerBlocks = include.answer ? details.map(answerBlock) : []
  // 页面由题目密度（auto/1/2/3）与答案位置（紧随题目/文末集中）共同决定。
  const pageLayout = options.pageLayout || "auto"
  const answerPosition = options.answerLayout || "after-each"
  const perPage = pageLayout === "one-per-page" ? 1
    : pageLayout === "two-per-page" ? 2
      : pageLayout === "three-per-page" ? 3 : 0
  const flow = (blocks: string[], className: string) => blocks.length
    ? `<section class="pdf-flow ${className}">${blocks.map(block => `<div class="pdf-slot">${block}</div>`).join("")}</section>`
    : ""
  let articles = ""
  if (answerPosition === "after-each" && include.answer && !perPage) {
    // 自动密度逐题交替；固定密度由下面的 pdf-page 分组。
    articles = flow(details.map((detail, index) => `${questionBlock(detail, index)}${include.answer ? answerBlock(detail, index) : ""}`), "pdf-compact-flow")
  } else if (!perPage) {
    articles = flow(questionBlocks, "pdf-question-flow") + flow(answerBlocks, "pdf-answer-flow")
  } else {
    const pageCount = Math.ceil(questionBlocks.length / perPage)
    const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
      const start = pageIndex * perPage
      const questions = questionBlocks.slice(start, start + perPage)
      const slots = questions.map((block, offset) => `<div class="pdf-slot">${block}${answerPosition === "after-each" && include.answer ? answerBlocks[start + offset] : ""}</div>`).join("")
      const questionPage = `<section class="pdf-page slots-${perPage}">${slots}</section>`
      return questionPage
    })
    articles = pages.join("") + (answerPosition === "end" ? flow(answerBlocks, "pdf-answer-flow") : "")
  }

  const imageScripts = assets.map(asset => `<script src="./${escapeHtml(asset.name)}"></script>`).join("")
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{width:186mm;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;color:#172033;font-size:12px;line-height:1.55}.pdf-slot{break-inside:avoid}.pdf-flow .pdf-slot+.pdf-slot{margin-top:1.55em}.pdf-flow{width:186mm}.pdf-answer-flow{padding:2mm 1mm}.pdf-page{width:186mm;min-height:273mm;page-break-before:always;break-after:page;display:grid;gap:0}.pdf-page:first-of-type{page-break-before:auto}.pdf-page.slots-1{grid-template-rows:1fr}.pdf-page.slots-2{grid-template-rows:repeat(2,minmax(0,1fr))}.pdf-page.slots-3{grid-template-rows:repeat(3,minmax(0,1fr))}.pdf-page .pdf-slot{min-height:0;padding:3mm 1mm}.mistake{padding:3mm 1mm 0;break-inside:avoid}.pdf-page .mistake{padding-top:0}.problem-title{display:flex;align-items:baseline;gap:8px;margin:0 0 2px;padding:0;border:0}.problem-title span{font-size:14px;font-weight:800;color:#111827;white-space:nowrap}.problem-title h1{font-size:18px;line-height:1.35;margin:0;font-weight:750}.problem-source{display:block;font-size:9.5px;color:#7b8494;margin:0 0 8px}.card-content,.answer-content{margin:0}.card-content .card,.answer-card .card{min-height:0!important;padding:0!important;background:#fff!important;color:#172033!important}.card-content .card>.eyebrow,.card-content .card>h1,.answer-card .card>.eyebrow,.answer-card .card>h1{display:none!important}.text-block,.html-block{font-size:13px!important;line-height:1.62!important;margin:7px 0!important;padding:8px 10px!important}.child{margin-top:10px!important;padding-top:8px!important}.child h2{font-size:13px!important;margin:0 0 6px!important}.card-content figure,.answer-content figure{margin:8px 0!important}.card-content figure.drawing,.answer-content figure.drawing{width:auto!important;max-width:46%!important;margin:6px auto!important}.card-content figure.drawing canvas[data-drawing]:not([data-drawing-overlay]),.answer-content figure.drawing canvas[data-drawing]:not([data-drawing-overlay]){display:block!important;width:auto!important;max-width:100%!important;max-height:45mm!important;margin:0 auto!important;object-fit:contain}.writing-space{height:22mm}.layout-one-per-page .writing-space{min-height:80mm}.layout-two-per-page .writing-space{min-height:35mm}.layout-three-per-page .writing-space{min-height:16mm}.layout-auto .writing-space{display:none}.no-question .writing-space{display:none!important}.review-meta{display:block;font-size:8.5px;color:#9aa2af;margin-top:2mm}.answer-unit{margin-top:8px}.answer-card{margin:0 0 12px;page-break-inside:auto}.answer-card>h2{font-size:12px;margin:8px 0 2px;padding:0;border:0}.answer-card>small{display:block;font-size:8.5px;color:#8a94a4;margin-bottom:5px}.notice{background:#f4f6f8;padding:10px;border-radius:6px;color:#64748b}img{max-height:240mm!important;object-fit:contain}.paint-note{position:relative}.paint-note canvas[data-drawing-overlay]{position:absolute;inset:0;width:100%;height:100%!important;background:transparent}.card-comment>summary{display:none}.card-comment{display:block}img,svg,canvas{max-width:100%!important;height:auto!important;page-break-inside:avoid}article,section,div,p{max-width:100%}.layout-auto .pdf-flow .pdf-slot+.pdf-slot{margin-top:0;border-top:1px dashed #e3e7ec}.layout-auto .mistake{padding:1.2mm 0}.layout-auto .problem-title{gap:5px;margin:0}.layout-auto .problem-title span{font-size:9px}.layout-auto .problem-title h1{font-size:11px;line-height:1.25;font-weight:700}.layout-auto .problem-source{display:inline;font-size:8px;margin:0 0 0 5px}.layout-auto .review-meta{display:inline;font-size:7.5px;margin:0 0 0 5px}.layout-auto .card-content,.layout-auto .answer-content{width:60%;min-width:0}.layout-auto .card-content .text-block,.layout-auto .card-content .html-block,.layout-auto .answer-content .text-block,.layout-auto .answer-content .html-block{font-size:11px!important;line-height:1.5!important;margin:4px 0!important;padding:5px 8px!important}.layout-auto .child{margin-top:6px!important;padding-top:4px!important}.layout-auto .child h2{font-size:11px!important;margin:0 0 4px!important}.layout-auto .card-content figure,.layout-auto .answer-content figure{margin:5px auto!important}.layout-auto .answer-card{margin:4px 0 0}.layout-auto .answer-card>h2{font-size:10px;margin:2px 0 1px}.layout-auto .answer-card>small{font-size:8px;margin-bottom:2px}.layout-auto .answer-unit{margin-top:4px}.layout-auto .notice{padding:5px;font-size:9px}.layout-auto .card-content p,.layout-auto .answer-content p{margin:2px 0}.layout-auto .problem-source,.layout-auto .review-meta{line-height:1.3}.layout-auto .card-content .child p,.layout-auto .answer-content .child p{margin:2px 0}</style></head><body class="layout-${pageLayout}${include.question ? "" : " no-question"}">${articles}${imageScripts}<script>${pkDrawingRendererScript}</script></body></html>`
}

/** Freeze one record at a time; the render document contains only a manifest. */
async function preparePagedPdf(options: MistakeExportOptions, limit = 0): Promise<any> {
  const root = `${cardLinkDocumentPath("exports")}/pdf-task-${exportStamp()}`
  ensureDirectory(root)
  const units: PdfUnit[] = []
  const files: PdfAssetScript[] = []
  try {
    const selected = await selectedDetails(options, limit, (detail, index) => {
      const html = buildMistakePdfHtml([detail], { ...options, pageLayout: "auto", answerLayout: options.answerLayout || "after-each" }, [], index)
      const body = bodyOf(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      const sections = body.match(/<section class="pdf-flow [^"]+">[\s\S]*?(?=<section class="pdf-flow |$)/g) || []
      sections.forEach((section, part) => {
        const name = `unit-${units.length + 1}.js`
        const path = `${root}/${name}`
        // Scripts are external UTF-8 files, never interpolated into an HTML script element.
        writeTextFile(path, `window.__MN_PDF_UNIT__=${JSON.stringify(section)};`)
        if (!NSFileManager.defaultManager().fileExistsAtPath(path)) throw new Error("PDF 题目暂存失败")
        files.push({ name, path })
        units.push({ name, kind: part === 0 ? "question" : "answer", index, title: detail.record.sourceTitle.replace(/\s+/g, " ").trim().slice(0, 160) })
      })
    }, root)
    if (!selected.count) throw new Error("当前导出范围没有可用错题")
    ensureNotCancelled()
    if (options.answerLayout === "end") units.sort((a, b) => Number(a.kind === "answer") - Number(b.kind === "answer") || a.index - b.index)
    const shell = buildMistakePdfHtml([], options)
      .replace(/<script>[\s\S]*?<\/script>/g, "")
      .replace('</body>', () => `<script data-pdf-drawing-renderer>window.__MN_PDF_DRAW__=function(){${pkDrawingRendererScript}};</script><script>window.__MN_PDF_MANIFEST__=${JSON.stringify({ units, pageLayout: options.pageLayout || "auto", answerLayout: options.answerLayout || "after-each" }).replace(/</g, "\\u003c")};</script></body>`)
    return { html: shell, pdfSourceDirectory: root, pdfAssets: [...selected.pdfAssets, ...files], count: selected.count, missing: selected.missing, total: selected.total }
  } catch (error) {
    try { (NSFileManager.defaultManager() as any).removeItemAtPath(root) } catch { /* Original failure wins. */ }
    throw error
  }
}

async function previewMistakeExportImpl(options: MistakeExportOptions): Promise<any> {
  // Only a bounded quick preview is supported, including direct bridge calls.
  const limit = Math.max(1, Math.min(3, Math.floor(Number(options.previewLimit) || 3)))
  if (options.format === "pdf") {
    const prepared = await preparePagedPdf(options, limit)
    return { ...prepared, renderPdfPreview: true, format: "pdf", previewCount: prepared.count, count: prepared.total, truncated: prepared.total > prepared.count }
  }
  const selected = await selectedDetails(options, limit)
  const details = selected.details
  if (!details.length) throw new Error("当前预览范围没有可用错题")
  const total = selected.total
  if (options.format === "md") {
    const result: any = { preview: true, format: "md", count: total, previewCount: details.length, missing: selected.missing, markdown: buildMistakeMarkdown(details, options) }
    if (limit > 0 && total > details.length) result.truncated = true
    return result
  }

}

async function exportMistakesImpl(options: MistakeExportOptions): Promise<any> {
  // 新一次导出重置取消标志：停止只作用于当次，不污染下一次。
  if (options.format === "pdf") {
    const prepared = await preparePagedPdf(options)
    if (prepared.missing) showHUD(`有 ${prepared.missing} 道错题因原卡片不可用被跳过`, 4)
    return { ...prepared, renderPdf: true, filename: cleanFilename(options.filename, "pdf") }
  }
  const { details, missing } = await selectedDetails(options)
  if (!details.length) throw new Error("当前导出范围没有可用错题")
  if (missing) showHUD(`有 ${missing} 道错题因原卡片不可用被跳过`, 4)
  if (options.format === "md") {
    const bundle = await saveMarkdownBundle(buildMistakeMarkdown(details, options), options.filename)
    return { saved: true, format: "md", filename: bundle.filename, count: details.length, assetCount: bundle.assetCount, missing }
  }
}

async function withPreparation(options: MistakeExportOptions, run: (options: MistakeExportOptions) => Promise<any>): Promise<any> {
  if (activePreparation.running) throw new Error("已有导出准备任务进行中")
  const context: PreparationContext = { cancelled: false, running: true, progress: { prepared: 0, total: 0 } }
  activePreparation = context
  try { return await run(JSON.parse(JSON.stringify(options))) }
  finally { context.running = false }
}

export function previewMistakeExport(options: MistakeExportOptions): Promise<any> {
  return withPreparation(options, previewMistakeExportImpl)
}

export function exportMistakes(options: MistakeExportOptions): Promise<any> {
  return withPreparation(options, exportMistakesImpl)
}
