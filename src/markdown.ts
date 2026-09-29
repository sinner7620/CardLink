import katex from "katex"
import { Marked } from "marked"
import { imageMimeFromBase64 } from "./base64"
import { escapeHtml } from "./html-utils"

type MathToken = {
  type: "blockMath" | "inlineMath"
  raw: string
  text: string
  displayMode: boolean
}

function renderMath(token: any): string {
  const mathToken = token as MathToken
  const rendered = katex.renderToString(mathToken.text.trim(), {
    displayMode: mathToken.displayMode,
    output: "mathml",
    strict: false,
    throwOnError: false
  })
  return mathToken.displayMode ? `<div class="katex-display">${rendered}</div>` : rendered
}

const markdown = new Marked({
  breaks: true,
  gfm: true
})

markdown.use({
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start(source: string) {
        const dollar = source.search(/^\s*\$\$/m)
        const bracket = source.search(/^\s*\\\[/m)
        const positions = [dollar, bracket].filter(position => position >= 0)
        return positions.length ? Math.min(...positions) : undefined
      },
      tokenizer(source: string): MathToken | undefined {
        const dollar = /^\s*\$\$\s*([\s\S]+?)\s*\$\$\s*(?:\n|$)/.exec(source)
        if (dollar) {
          return {
            type: "blockMath",
            raw: dollar[0],
            text: dollar[1],
            displayMode: true
          }
        }
        const bracket = /^\s*\\\[\s*([\s\S]+?)\s*\\\]\s*(?:\n|$)/.exec(source)
        if (!bracket) return undefined
        return {
          type: "blockMath",
          raw: bracket[0],
          text: bracket[1],
          displayMode: true
        }
      },
      renderer: renderMath
    },
    {
      name: "inlineMath",
      level: "inline",
      start(source: string) {
        const dollar = source.search(/\$(?!\$)/)
        const paren = source.indexOf("\\(")
        const positions = [dollar, paren].filter(position => position >= 0)
        return positions.length ? Math.min(...positions) : undefined
      },
      tokenizer(source: string): MathToken | undefined {
        const dollar = /^\$(?!\$)((?:\\.|[^\\$\n])+?)\$(?!\$)/.exec(source)
        if (dollar) {
          return {
            type: "inlineMath",
            raw: dollar[0],
            text: dollar[1],
            displayMode: false
          }
        }
        const paren = /^\\\(((?:\\.|[^\\])+?)\\\)/.exec(source)
        if (!paren) return undefined
        return {
          type: "inlineMath",
          raw: paren[0],
          text: paren[1],
          displayMode: false
        }
      },
      renderer: renderMath
    }
  ]
})

export type MarkdownMediaResolver = (hash: string) => string | undefined

const MARGINNOTE_MARKDOWN_IMAGE_URL = /^marginnote4app:\/\/markdownimg\/(?:png|jpe?g|gif|webp)\/([^?#]+)(?:[?#].*)?$/i
const MARGINNOTE_MARKDOWN_IMAGE_IN_TEXT = /!\[[^\]]*\]\(marginnote4app:\/\/markdownimg\/(?:png|jpe?g|gif|webp)\/[^\s)"'<>]+\)/gi

function decodeMediaHash(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveMarginNoteMarkdownImages(html: string, resolveMedia: MarkdownMediaResolver): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const sourceAttribute = tag.match(/\bsrc=(['"])(.*?)\1/i)
    const source = sourceAttribute?.[2] || ""
    const match = source.match(MARGINNOTE_MARKDOWN_IMAGE_URL)
    if (!match || !sourceAttribute) return tag
    const mediaId = decodeMediaHash(match[1])
    const base64 = resolveMedia(mediaId)
    if (!base64) return tag
    const resolvedSource = `data:${imageMimeFromBase64(base64)};base64,${base64}`
    const withSource = tag.replace(sourceAttribute[0], `src="${resolvedSource}"`)
    return /\bdata-media-id=/i.test(withSource)
      ? withSource
      : withSource.replace(/<img\b/i, `<img data-media-id="${escapeHtml(mediaId)}"`)
  })
}

export function hasUnsupportedMarginNoteUrl(source: string): boolean {
  return /marginnote(?:3|4)app:\/\//i.test(String(source || "").replace(MARGINNOTE_MARKDOWN_IMAGE_IN_TEXT, ""))
}

export function renderMarkdown(source: string, resolveMedia?: MarkdownMediaResolver): string {
  const html = markdown.parse(source, { async: false }) as string
  return resolveMedia ? resolveMarginNoteMarkdownImages(html, resolveMedia) : html
}
