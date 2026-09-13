import { cardHtmlToMarkdown } from "./card-markdown"
import { sha256Hex } from "./content-fingerprint"

export interface PreparationPolicy {
  privacy: { handwriting: boolean }
  ocrEngine: "mineru" | "glm-ocr"
  mineru: { enabled: boolean; baseUrl: string; language: string; enableFormula: boolean; enableTable: boolean }
  glmOcr: { baseUrl: string; model: string }
}

export function preparationPolicyFingerprint(settings: PreparationPolicy): string {
  const { privacy, mineru, glmOcr } = settings
  return sha256Hex(JSON.stringify({ version: 4, handwriting: privacy.handwriting, enabled: mineru.enabled,
    engine: settings.ocrEngine, engineSettings: settings.ocrEngine === "glm-ocr"
      ? { baseUrl: glmOcr.baseUrl, model: glmOcr.model }
      : { baseUrl: mineru.baseUrl, language: mineru.language, formula: mineru.enableFormula, table: mineru.enableTable } }))
}

/**
 * 手写内容（卡片内笔迹与脑图绑定手写）永远不会进入 OCR 截图：
 * OCR 收到的始终是去除手写后的整张题目卡片，手写以独立图片随分析请求发送。
 */
export function filterQuestionMedia(html: string, handwriting: boolean): string {
  let result = html
  if (!handwriting) result = result.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas\s*>/gi, "")
  if (!handwriting) {
    // 没有笔迹时，保留的底图应独立绘制，不能继续等待不存在的 overlay 图片。
    result = result.replace(/\sdata-drawing-overlay=["']true["']/gi, "")
      .replace(/class=["']paint-note["']/gi, 'class="drawing"')
  }
  return result
}

/** 纯文本提取（题目/参考答案）：图片与手写都不算文字，纯图片题提取结果为空。 */
export function questionNativeText(html: string): string {
  const textOnly = html.replace(/<img\b[^>]*>/gi, "")
  return cardHtmlToMarkdown(filterQuestionMedia(textOnly, false)).trim()
}

export function questionBody(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html
  return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
}

/**
 * 题目输入规划：有可直接读取的题干文字时走原生文字（needsOCR=false），
 * 含图片的题目才需要整卡 OCR（needsOCR=true）。ocrHtml 是去除手写的整卡
 * （对应最终发给 OCR 的画面）；开启手写内容时 renderHtml 保留卡片手写并
 * 追加脑图绑定手写，供网页端先单独捕获手写元素、再隐藏它们截出无手写整卡。
 */
export function planQuestionInput(questionHtml: string, settings: PreparationPolicy, boundHtml = "") {
  const { privacy, mineru } = settings
  const ocrHtml = filterQuestionMedia(questionHtml, false)
  const renderHtml = privacy.handwriting
    ? filterQuestionMedia(questionHtml, true).replace(/<\/article>/i, `${questionBody(boundHtml)}</article>`)
    : ocrHtml
  // 卡片标题、分区标题和缺失媒体提示不能把纯图片题误判成有题干文字。
  const content = questionBody(ocrHtml).replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*(?:eyebrow|missing-image)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
  const hasText = !!questionNativeText(content).trim()
  const hasMedia = /<img\b/i.test(questionBody(ocrHtml))
  const needsOCR = mineru.enabled && hasMedia
  return { ocrHtml, html: renderHtml, hasText, hasMedia, needsOCR, nativeText: questionNativeText(ocrHtml) }
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

export interface ModelImageAttachment { reference: string; dataUri: string }
/** 分析请求的用户消息内容：文字在前，图片走服务实际支持的图像字段，绝不把 Base64 拼进 prompt 文本。 */
export function analysisUserContent(prompt: string, attachments: ModelImageAttachment[], chatCompletions: boolean) {
  const textPart = chatCompletions ? { type: "text", text: prompt } : { type: "input_text", text: prompt }
  const imageParts = attachments.map(item => chatCompletions
    ? { type: "image_url", image_url: { url: item.dataUri } }
    : { type: "input_image", image_url: item.dataUri })
  return [textPart, ...imageParts]
}
