export const REPORT_SCHEMA = { type: "object", additionalProperties: false, properties: {
  summary: { type: "string" }, strengths: { type: "array", items: { type: "string" } },
  weakPoints: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, severity: { type: "string" }, reason: { type: "string" }, suggestion: { type: "string" }, evidence: { type: "array", items: { type: "string" } } }, required: ["title", "severity", "reason", "suggestion", "evidence"] } },
  errorPatterns: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" }, evidence: { type: "array", items: { type: "string" } } }, required: ["title", "detail", "evidence"] } },
  reviewAdvice: { type: "array", items: { type: "object", additionalProperties: false, properties: { priority: { type: "string" }, title: { type: "string" }, action: { type: "string" }, evidence: { type: "array", items: { type: "string" } } }, required: ["priority", "title", "action", "evidence"] } }, limitations: { type: "array", items: { type: "string" } }
}, required: ["summary", "strengths", "weakPoints", "errorPatterns", "reviewAdvice", "limitations"] }

export const REPORT_FORMAT_INSTRUCTION = `只输出一个 JSON 对象，不要使用 Markdown 代码围栏。字段名必须严格使用 summary、strengths、weakPoints、errorPatterns、reviewAdvice、limitations。JSON Schema：${JSON.stringify(REPORT_SCHEMA)}`

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""
}
function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined
}
function first(value: Record<string, any>, keys: string[]): any {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key]
}
function list(value: unknown): any[] { return Array.isArray(value) ? value : value == null ? [] : [value] }
function stringList(value: unknown, maxItems: number): string[] {
  return Array.from(new Set(list(value).map(item => cleanText(typeof item === "string" ? item : first(record(item) || {}, ["title", "text", "name", "内容"]), 500)).filter(Boolean))).slice(0, maxItems)
}
function evidence(value: Record<string, any>): string[] { return stringList(first(value, ["evidence", "证据", "references", "refs", "引用"]), 30) }

function balancedJSONObject(source: string): string | undefined {
  let start = -1, depth = 0, quote = false, escaped = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (start < 0) { if (char === "{") { start = index; depth = 1 } continue }
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return source.slice(start, index + 1)
  }
}

function decodeReportJSON(raw: string): any {
  const trimmed = String(raw || "").trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidates = [trimmed, fenced, balancedJSONObject(fenced || trimmed)].filter((item): item is string => !!item)
  for (const candidate of candidates) {
    try {
      let value = JSON.parse(candidate)
      if (typeof value === "string") value = JSON.parse(value)
      return value
    } catch {}
  }
  throw new Error("AI 返回内容不是有效 JSON，请重试")
}

export interface ParsedAIReport {
  summary: string
  strengths: string[]
  weakPoints: Array<{ title: string; severity: string; reason: string; suggestion: string; evidence: string[] }>
  errorPatterns: Array<{ title: string; detail: string; evidence: string[] }>
  reviewAdvice: Array<{ priority: string; title: string; action: string; evidence: string[] }>
  limitations: string[]
}

export function parseAIReport(raw: string): ParsedAIReport {
  const decoded = decodeReportJSON(raw)
  const root = record(decoded) || {}
  const value = record(first(root, ["mistake_report", "report", "报告", "分析报告", "错题报告", "result", "data"])) || root
  const summaryValue = first(value, ["summary", "overall_summary", "summaryText", "总结", "总体总结", "整体分析", "摘要", "概述"])
  const summary = cleanText(typeof summaryValue === "string" ? summaryValue : first(record(summaryValue) || {}, ["text", "content", "内容"]), 500)
  if (!summary) {
    const keys = Object.keys(value).slice(0, 8).join("、") || "无"
    throw new Error(`AI 返回的报告缺少 summary 文本（实际字段：${keys}）`)
  }
  const weakPoints = list(first(value, ["weakPoints", "weak_points", "薄弱点", "薄弱环节"])).map(item => record(item) || { title: item }).map(item => ({
    title: cleanText(first(item, ["title", "标题", "name"]), 120), severity: cleanText(first(item, ["severity", "严重程度", "level"]), 40),
    reason: cleanText(first(item, ["reason", "原因", "detail"]), 500), suggestion: cleanText(first(item, ["suggestion", "建议", "action"]), 500), evidence: evidence(item)
  })).slice(0, 8)
  const errorPatterns = list(first(value, ["errorPatterns", "error_patterns", "错误模式", "错误类型"])).map(item => record(item) || { title: item }).map(item => ({
    title: cleanText(first(item, ["title", "标题", "name"]), 120), detail: cleanText(first(item, ["detail", "详情", "描述", "reason"]), 500), evidence: evidence(item)
  })).slice(0, 8)
  const reviewAdvice = list(first(value, ["reviewAdvice", "review_advice", "复习建议", "学习建议"])).map(item => record(item) || { title: item, action: item }).map(item => ({
    priority: cleanText(first(item, ["priority", "优先级", "level"]), 40), title: cleanText(first(item, ["title", "标题", "name"]), 120),
    action: cleanText(first(item, ["action", "行动", "建议", "detail"]), 500), evidence: evidence(item)
  })).slice(0, 8)
  return {
    summary,
    strengths: stringList(first(value, ["strengths", "优势", "掌握较好", "优点"]), 6),
    weakPoints,
    errorPatterns,
    reviewAdvice,
    limitations: stringList(first(value, ["limitations", "局限", "限制", "说明"]), 8)
  }
}

function structuredText(value: unknown): string {
  if (typeof value === "string") return value
  return record(value) ? JSON.stringify(value) : ""
}

/** 兼容 Responses、Chat Completions 及兼容服务的字符串/结构化正文。 */
export function extractAIOutputText(value: any): string {
  const direct = structuredText(value?.output_text); if (direct) return direct
  for (const item of value?.output || []) for (const part of item?.content || []) {
    const candidate = structuredText(part?.text) || structuredText(part?.json) || structuredText(part?.parsed)
    if (candidate) return candidate
  }
  const message = value?.choices?.[0]?.message
  const content = message?.content
  if (Array.isArray(content)) for (const part of content) {
    const candidate = structuredText(part?.text) || structuredText(part?.json) || structuredText(part)
    if (candidate) return candidate
  }
  return structuredText(content) || structuredText(message?.parsed)
}
