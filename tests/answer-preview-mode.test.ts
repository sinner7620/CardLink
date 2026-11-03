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

test("答案文档始终由原生缩放滚动，旧插件模式参数也不能恢复手势运行时", async () => {
  const runtime = await build({ entryPoints: ["src/card-preview-webview.ts"], bundle: true, write: false, format: "iife" })
  const renderer = await build({ entryPoints: ["src/card-html.ts"], bundle: true, write: false, format: "iife", globalName: "renderer", define: { __CARD_PREVIEW_SCRIPT__: JSON.stringify(runtime.outputFiles[0].text) } })
  const context: any = {}
  runInNewContext(renderer.outputFiles[0].text, context)
  const html = context.renderer.renderCardHtml({ noteTitle: "测试", comments: [] }, "题目", () => null, () => null)
  assert.match(html, /__mnMountCardPreview/)
  const native = answerPreviewDocument(html, "native")
  assert.doesNotMatch(native, /__mnMountCardPreview|__mnCardPreview|cardlink-preview-runtime/)
  assert.match(native, /user-scalable=yes/)
  assert.match(native, /cardlink\.comment\./)
  assert.match(native, /__mnPkdrawingCore/)
  assert.match(native, /显示脑图手写/)
  const view: any = { loadHTMLStringBaseURL(value: string) { this.html = value } }
  loadAnswerPreview(view, html, "native")
  assert.equal(view.scalesPageToFit, true); assert.equal(view.html, native)
  loadAnswerPreview(view, html, "custom")
  assert.equal(view.scalesPageToFit, true); assert.equal(view.html, native)
})
