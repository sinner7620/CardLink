import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { runInNewContext } from "node:vm"
import { readFileSync } from "node:fs"
import { transpileModule } from "typescript"
import { answerPreviewDocument, loadAnswerPreview } from "../src/answer-preview-mode"

test("旧缩放选择命令只返回原生模式，不能重新启用插件手势", async () => {
  const source = readFileSync("src/rails-core.ts", "utf8")
  const body = source.slice(source.indexOf('  if (command === "chooseAnswerPreviewMode")'), source.indexOf('  if (command === "setReviewAlgorithm")'))
  const state: any = { debugModeEnabled: false, debugAnswerPreviewMode: "custom" }
  let index = -1, prompts = 0
  const context: any = { exports: {}, CardLinkError: Error,
    loadMatcherSettings: () => state, saveMatcherSettings: (value: any) => Object.assign(state, value),
    delay: async () => {}, select: async () => { prompts++; return { index } }
  }
  runInNewContext(transpileModule(`export async function choose(command: string) {${body}}`, { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  const choose = () => context.exports.choose("chooseAnswerPreviewMode")
  await assert.rejects(choose(), /debugModeRequired/); assert.equal(prompts, 0)
  state.debugModeEnabled = true
  await choose(); assert.equal(state.debugAnswerPreviewMode, "native")
  index = 1; await choose(); assert.equal(state.debugAnswerPreviewMode, "native")
  index = 0; await choose(); assert.equal(state.debugAnswerPreviewMode, "native")
  assert.equal(prompts, 0)
})

test("独立答案保留原生阅读缩放，旧模式参数不会启用通用预览手势", async () => {
  const runtime = await build({ entryPoints: ["src/card-preview-webview.ts"], bundle: true, write: false, format: "iife" })
  const renderer = await build({ entryPoints: ["src/card-html.ts"], bundle: true, write: false, format: "iife", globalName: "renderer", define: { __CARD_PREVIEW_SCRIPT__: JSON.stringify(runtime.outputFiles[0].text) } })
  const context: any = {}
  runInNewContext(renderer.outputFiles[0].text, context)
  const html = context.renderer.renderCardHtml({ noteTitle: "测试", comments: [] }, "题目", () => null, () => null)
  assert.match(html, /__mnMountCardPreview/)
  const native = answerPreviewDocument(html, "native")
  assert.doesNotMatch(native, /__mnMountCardPreview|__mnCardPreview|cardlink-preview-runtime/)
  assert.match(html, /user-scalable=yes/, "shared card documents keep their own viewport")
  assert.match(native, /initial-scale=1,minimum-scale=0.6,maximum-scale=3,user-scalable=yes/)
  assert.match(native, /cardlink\.comment\./)
  assert.match(native, /__mnPkdrawingCore/)
  assert.match(native, /显示脑图手写/)
  const inkTag = `cardlink-answer-ink-${"a".repeat(64)}-${"b".repeat(64)}`
  const card = {
    noteId: "answer", comments: [
      { type: "TextNote", text: "答案文字评论" },
      { type: "LinkNote", noteid: "linked" },
      { type: "HtmlNote", tag: inkTag, html: "<p>主卡批注图</p>" }
    ], childNotes: [{ noteId: "child", comments: [
      { type: "HtmlNote", tag: inkTag, html: "<p>子卡批注图</p>" }
    ] }]
  }
  const linked = { noteId: "linked", comments: [{ type: "HtmlNote", tag: inkTag, html: "<p>链接卡批注图</p>" }] }
  const folded = answerPreviewDocument(context.renderer.renderCardHtml(card, "题目", (id: string) => id === "linked" ? linked : undefined, () => null, () => null,
    true, true, true, { excludeAnswerInk: true }))
  assert.match(folded, /data-comment-key="answer:0"><summary>评论 1/)
  assert.match(folded, /data-comment-key="answer:1"><summary>评论 2<\/summary>/)
  assert.match(folded, /data-comment-key="linked:0"><summary>评论 1<\/summary>[\s\S]*链接卡批注图/)
  assert.match(folded, /data-comment-key="child:0"><summary>评论 1<\/summary>[\s\S]*子卡批注图/)
  assert.doesNotMatch(folded, /主卡批注图/)
  const exported = { noteId: "exported", comments: [
    { type: "HtmlNote", mnCommentDisplay: { v: 1, collapsed: true },
      html: '<html><body style="margin:0"><img alt="折叠图片" src="data:image/png;base64,AAAA"></body></html>' },
    { type: "LinkNote", mnCommentDisplay: { v: 1, collapsed: false }, q_hpic: { paint: "expanded-image" } },
    { type: "LinkNote", q_hpic: { paint: "legacy-image" } },
    { type: "PaintNote", mnCommentDisplay: { v: 1, collapsed: true }, paint: "later-folded-image" }
  ] }
  const rendered = context.renderer.renderCardHtml(exported, "题目", () => undefined, () => "iVBORw0KGgo=", undefined,
    true, true, true, { respectCommentDisplay: true })
  assert.equal(rendered.match(/<\/body>/g)?.length, 1)
  assert.match(rendered, /data-comment-key="exported:0"><summary>评论 1<\/summary>[\s\S]*alt="折叠图片"/)
  assert.match(rendered, /data-comment-key="exported:1" open><summary>评论 2<\/summary>[\s\S]*data-media-id="expanded-image"/)
  assert.match(rendered, /data-comment-key="exported:2"><summary>评论 3<\/summary>[\s\S]*data-media-id="legacy-image"/)
  assert.match(rendered, /data-comment-key="exported:3"><summary>评论 4<\/summary>[\s\S]*data-media-id="later-folded-image"/)
  const documentWithCommentEnd = '<html><body><article><!-- </body> -->末尾评论</article></body></html>'
  assert.ok(answerPreviewDocument(documentWithCommentEnd).indexOf("data-bound-handwriting") > documentWithCommentEnd.indexOf("末尾评论"))
  const view: any = { scalesPageToFit: false, loadHTMLStringBaseURL(value: string) {
      assert.equal(this.scalesPageToFit, true, "enable native reading zoom before loading")
      this.html = value
    } }
  loadAnswerPreview(view, html, "native")
  assert.equal(view.scalesPageToFit, true); assert.equal(view.html, native)
  loadAnswerPreview(view, html, "custom")
  assert.equal(view.scalesPageToFit, true); assert.equal(view.html, native)
})

test("独立答案窗口可以打开批注，阅读页继续使用宿主滚动", () => {
  const html = '<html><body><article class="card">答案</article></body></html>'
  const view = { html: "", scalesPageToFit: false, scrollView: { scrollEnabled: false }, loadHTMLStringBaseURL(value: string) { this.html = value } }
  loadAnswerPreview(view, html)
  assert.doesNotMatch(view.html, /cardlink-answer-ink:\/\/open/)
  loadAnswerPreview(view, html, "native", document => document.replace("</body>", "<button>批注</button></body>"))
  assert.match(view.html, /<button>批注<\/button>/)
  assert.equal(view.scrollView.scrollEnabled, true)
  assert.equal(view.scalesPageToFit, true)
})
