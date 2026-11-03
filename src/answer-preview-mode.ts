export type AnswerPreviewMode = "custom" | "native"

/** Legacy mode arguments are accepted but no longer enable a gesture engine.
 * Keep unrelated media rendering and comment persistence intact.
 */
export function answerPreviewDocument(html: string, _mode: AnswerPreviewMode = "native"): string {
  return html
    .replace(/<script id="cardlink-preview-runtime">[\s\S]*?<\/script>/, "")
    .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=0.6,maximum-scale=3,user-scalable=yes">')
    .replace("</body>", `<script>(()=>{const h=document.querySelector('[data-bound-handwriting]:not([data-bound-handwriting="always"])');if(!h)return;const b=document.createElement('button');b.type='button';const update=()=>{b.textContent=h.hidden?'显示脑图手写':'隐藏脑图手写';b.setAttribute('aria-expanded',String(!h.hidden))};b.onclick=()=>{h.hidden=!h.hidden;update()};update();h.before(b)})();</script></body>`)
}

export function loadAnswerPreview(view: any, html: string, _mode: AnswerPreviewMode = "native"): void {
  view.scalesPageToFit = true
  if (view.scrollView) view.scrollView.scrollEnabled = true
  view.loadHTMLStringBaseURL(answerPreviewDocument(html), null)
}
