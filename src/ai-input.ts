import { cardHtmlToMarkdown } from "./card-markdown"
import { sha256Hex } from "./content-fingerprint"

export interface PreparationPolicy {
  privacy: { images: "when-needed" | "always" | "never"; handwriting: boolean; mindMapHandwriting: boolean }
  ocrEngine: "mineru" | "glm-ocr"
  mineru: { enabled: boolean; policy: "auto" | "all" | "image-only" | "never"; baseUrl: string; language: string; enableFormula: boolean; enableTable: boolean }
  glmOcr: { baseUrl: string; model: string }
}

export function preparationPolicyFingerprint(settings: PreparationPolicy): string {
  const { privacy, mineru, glmOcr } = settings
  return sha256Hex(JSON.stringify({ version: 3, images: privacy.images, handwriting: privacy.handwriting,
    mindMapHandwriting: privacy.mindMapHandwriting, enabled: mineru.enabled, policy: mineru.policy,
    engine: settings.ocrEngine, engineSettings: settings.ocrEngine === "glm-ocr"
      ? { baseUrl: glmOcr.baseUrl, model: glmOcr.model }
      : { baseUrl: mineru.baseUrl, language: mineru.language, formula: mineru.enableFormula, table: mineru.enableTable } }))
}

/** 只处理插件生成的卡片 HTML；过滤发生在进入截图窗口之前。 */
export function filterQuestionMedia(html: string, images: boolean, handwriting: boolean): string {
  let result = html
  if (!handwriting) result = result.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas\s*>/gi, "")
  if (!images) {
    result = result.replace(/<img\b[^>]*>/gi, "")
    // 没有底图时，保留的笔迹应独立绘制，不能继续等待不存在的 overlay 图片。
    result = result.replace(/\sdata-drawing-overlay=["']true["']/gi, "")
      .replace(/class=["']paint-note["']/gi, 'class="drawing"')
  }
  return result
}

export function questionNativeText(html: string): string {
  return cardHtmlToMarkdown(filterQuestionMedia(html, false, false)).trim()
}

export function questionBody(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html
  return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
}

export function planQuestionInput(questionHtml: string, settings: PreparationPolicy, boundHtml = "") {
  const { privacy, mineru } = settings
  const allowImages = privacy.images !== "never"
  let html = filterQuestionMedia(questionHtml, allowImages, allowImages && privacy.handwriting)
  if (allowImages && privacy.mindMapHandwriting && boundHtml) {
    html = html.replace(/<\/article>/i, `${questionBody(boundHtml)}</article>`)
  }
  const body = questionBody(html)
  const hasMedia = /<(?:img|canvas)\b/i.test(body)
  // 卡片标题、分区标题和缺失媒体提示不能把纯图片题误判成有题干文字。
  const content = body.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*(?:eyebrow|missing-image)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
  const hasText = !!questionNativeText(content).trim()
  const needsOCR = allowImages && mineru.enabled && mineru.policy !== "never"
    && (privacy.images === "always" || hasMedia)
    && (mineru.policy === "all" || (mineru.policy === "image-only" ? hasMedia && !hasText : hasMedia))
  return { html, hasMedia, hasText, needsOCR, nativeText: questionNativeText(html) }
}

export interface PreparedInputIdentity { sourceFingerprint: string; policyFingerprint: string }
export function preparedInputMatches(snapshot: any, identity: PreparedInputIdentity): boolean {
  return snapshot?.schemaVersion === 3 && snapshot.status === "ready" && !!snapshot.questionText?.trim()
    && snapshot.sourceFingerprint === identity.sourceFingerprint && snapshot.policyFingerprint === identity.policyFingerprint
}

export interface AnalysisItem { reference: string; recordId: string; text: string }
/** 按完整题目装包，引用表只包含实际进入请求的题目。 */
export function packAnalysisItems(items: AnalysisItem[], budget = 120000) {
  const selected: AnalysisItem[] = [], evidence: Record<string, string> = {}
  let used = 0
  for (const item of items) {
    const size = item.text.length + (selected.length ? 2 : 0)
    if (used + size > budget) continue
    selected.push(item)
    evidence[item.reference] = item.recordId
    used += size
  }
  return { text: selected.map(item => item.text).join("\n\n"), selected, evidence, omitted: items.length - selected.length }
}
