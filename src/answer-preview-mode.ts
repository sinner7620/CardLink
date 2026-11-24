import { appendToHtmlBody } from "./html-utils"

export type AnswerPreviewMode = "custom" | "native"

/** Legacy mode arguments use the same native reading gestures.
 * Keep unrelated media rendering and comment persistence intact.
 */
export function answerPreviewDocument(html: string, _mode: AnswerPreviewMode = "native"): string {
  const document = html.replace(/<script id="cardlink-preview-runtime">[\s\S]*?<\/script>/, "")
  return appendToHtmlBody(document, `<script>(()=>{const h=document.querySelector('[data-bound-handwriting]:not([data-bound-handwriting="always"])');if(!h)return;const b=document.createElement('button');b.type='button';b.dataset.answerBoundToggle='';const update=()=>{b.textContent=h.hidden?'显示脑图手写':'隐藏脑图手写';b.setAttribute('aria-expanded',String(!h.hidden))};b.onclick=()=>{h.hidden=!h.hidden;update()};update();h.before(b)})();</script>`)
}

export function loadAnswerPreview(view: any, html: string, _mode: AnswerPreviewMode = "native", decorate?: (document: string) => string): void {
  view.scalesPageToFit = true
  if (view.scrollView) view.scrollView.scrollEnabled = true
  const document = answerPreviewDocument(html)
  view.loadHTMLStringBaseURL(decorate ? decorate(document) : document, null)
}
