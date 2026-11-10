import { cardHtmlToMarkdown } from "./card-markdown"

export function questionNativeText(html: string): string {
  const textOnly = html.replace(/<img\b[^>]*>/gi, "")
  return cardHtmlToMarkdown(textOnly.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas\s*>/gi, "")).trim()
}

export function questionBody(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html
  return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
}

