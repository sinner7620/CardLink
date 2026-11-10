import test, { mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const calls: Array<{ id: string; content: string; forExport: boolean }> = []
const files = new Map<string, string>()
let includeDrawing = false
let delayHook: (() => void) | undefined
let failWrite = false
const records = ["first", "bad", "last"].map(recordId => ({ recordId, noteAvailable: true }))
function detail(id: string): any {
  return { record: { recordId: id, sourceTitle: id, sourceNotebookTitle: "专业课", sourcePathTitles: ["信号", "真题年份分类", "2013年"], level: 0, createdAt: "2026-11-07", reviewCount: 1, history: [{ at: "2026-11-06", level: 1 }] },
    questionHtml: '<body>' + (includeDrawing ? '<canvas data-drawing-id="drawing" data-drawing="AP/+"></canvas>' : '') + '<p>' + id + '</p><img data-media-id="same" src="data:image/png;base64,YWJj"><script>previewOnly()</script></body>',
    answers: [{ id: "answer", title: "解答", path: "信号", html: '<body><p>答案</p><script>previewOnly()</script></body>' }], answerStatus: "ready" }
}
mock.module("../src/mistake-manager", { namedExports: {
  mistakeWorkbenchData: () => ({ records }),
  mistakeDetailById: (id: string, content: string, forExport: boolean) => {
    calls.push({ id, content, forExport })
    if (id === "bad") throw new Error("broken card")
    const result = detail(id)
    if (content === "question") result.answers = []
    return result
  }
} })
mock.module("../src/note-navigation", { namedExports: { recordRuntimeState() {}, captureDiagnosticError() {} } })
mock.module("marginnote", { namedExports: {
  MN: { app: { documentPath: "/docs" } }, delay: async () => { delayHook?.() }, saveFile() {}, showHUD() {}, writeTextFile: (path: string, text: string) => { if (failWrite) throw new Error("disk-full"); files.set(path, text) }
} })
Object.assign(globalThis, {
  NSFileManager: { defaultManager: () => ({ fileExistsAtPath: () => true, contentsOfDirectoryAtPathError: () => [] }) },
  NSData: { dataWithStringEncoding: (text: string) => ({ length: () => text.length, writeToFileAtomically: (path: string) => { files.set(path, text); return true } }) },
  NSURL: { fileURLWithPath: (path: string) => ({ absoluteString: () => "file://" + path }) }
})

test("导出保留请求顺序、跳过损坏卡片，不含答案时不执行答案读取", async () => {
  const { previewMistakeExport } = await import("../src/mistake-export")
  calls.length = 0
  const result = await previewMistakeExport({ format: "md", recordIds: ["last", "bad", "first", "last"], include: { answer: false } })
  assert.deepEqual(calls.map(call => call.id), ["last", "bad", "first"])
  assert.ok(calls.every(call => call.content === "question" && call.forExport))
  assert.equal(result.count, 2)
  assert.ok(result.markdown.indexOf("## 1. last") < result.markdown.indexOf("## 2. first"))
  assert.doesNotMatch(result.markdown, /previewOnly|答案卡片/)
})

test("PDF 图片以 UTF-8 资源脚本分批暂存，同一媒体复用且原始 base64 不变", async () => {
  const { previewMistakeExport } = await import("../src/mistake-export")
  files.clear()
  const result = await previewMistakeExport({ format: "pdf", recordIds: ["last", "first"] })
  assert.equal([...files.keys()].filter(path => /image-\d+\.js$/.test(path)).length, 1)
  const images = [{ src: "" }, { src: "" }]
  runInNewContext([...files.values()][0], { document: { querySelectorAll: () => images } })
  assert.deepEqual(images.map(image => image.src), ["data:image/png;base64,YWJj", "data:image/png;base64,YWJj"])
  assert.equal(result.pdfAssets.filter((asset: any) => asset.name.startsWith("image-")).length, 1)
  assert.doesNotMatch(result.html, /data:image\/png;base64,YWJj|previewOnly/)
  assert.doesNotMatch(result.html, /<script src="\.\/image-1\.js"><\/script>/)
  assert.match(result.html, /__MN_PDF_MANIFEST__/)
  assert.doesNotMatch(result.html, /class="mistake question-unit"/)
  assert.doesNotMatch(result.html, /file:\/\//)
})

test("固定题数同时用于逐题答案布局，完整复习历史与概要不同", async () => {
  const { buildMistakePdfHtml } = await import("../src/mistake-export")
  const details = Array.from({ length: 5 }, (_, index) => detail(String(index)))
  for (const [layout, size] of [["one-per-page", 1], ["two-per-page", 2], ["three-per-page", 3]] as const) {
    const html = buildMistakePdfHtml(details, { format: "pdf", pageLayout: layout, answerLayout: "after-each", reviewDetail: "full" })
    assert.equal((html.match(/<section class="pdf-page /g) || []).length, Math.ceil(5 / size))
    assert.ok(html.indexOf('<span>答案 1</span>') < html.indexOf('<span>2.</span>'))
    assert.match(html, /class="review-history"/)
  }
  assert.doesNotMatch(buildMistakePdfHtml(details, { format: "pdf", reviewDetail: "summary" }), /class="review-history"/)
})

test("MathML 转 Markdown 只保留原始 TeX，不重复输出展示树", async () => {
  const { cardHtmlToMarkdown } = await import("../src/card-markdown")
  assert.equal(cardHtmlToMarkdown('<math><semantics><mfrac><mi>x</mi><mn>2</mn></mfrac><annotation encoding="application/x-tex">\\frac{x}{2}</annotation></semantics></math>').trim(), '$\\frac{x}{2}$')
})

function nativeBridge(asyncProgress = false) {
  const timers: Array<() => void> = []
  let resolveCore: (value: any) => void = () => {}
  let coreCalls = 0
  const controller: any = {}
  const context = { controller, addon: {} }
  const scope: any = { Promise, Date, Error,
    NSTimer: { scheduledTimerWithTimeInterval: (_time: number, _repeat: boolean, callback: () => void) => { timers.push(callback); return { invalidate() {} } } },
    __MN_ANSWER_CORE_GLOBAL__: { bridge: (command: string) => {
      if (command === "exportMistakes") { coreCalls++; return new Promise(resolve => { resolveCore = resolve }) }
      if (command === "mistakeExportPreparationStatus") return asyncProgress ? Promise.resolve({ prepared: 2, total: 4 }) : { prepared: 2, total: 4 }
    } }
  }
  runInNewContext(readFileSync("rails-native/WebBridgeCommands.js", "utf8"), scope)
  return { dispatch: (command: string, payload?: any) => scope.__MNAM_WEB_BRIDGE_GLOBAL__.dispatch(context, command, payload), timers, controller, resolve: (value: any) => resolveCore(value), calls: () => coreCalls }
}

test("PDF 准备先受理任务，状态/取消核对 ID；取消后不启动原生渲染", async () => {
  const native = nativeBridge()
  const result = native.dispatch("exportMistakes", { format: "pdf", recordIds: ["1"] })
  assert.equal(result.taskAccepted, true)
  assert.equal(result.status, "preparing")
  assert.equal(native.calls(), 0)
  assert.equal(native.dispatch("pdfTaskStatus", { id: result.taskId }).progress, 18)
  assert.equal(native.dispatch("pdfTaskCancel", { id: "stale" }).cancelled, false)
  native.timers[0]()
  await Promise.resolve()
  assert.equal(native.calls(), 1)
  assert.equal(native.dispatch("pdfTaskCancel", { id: result.taskId }).cancelled, true)
  assert.throws(() => native.dispatch("exportMistakes", { format: "pdf" }), /已有导出/)
  native.resolve({ renderPdf: true, html: "must never render" })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(native.controller.exportPdfTask.status, "cancelled")
  assert.equal(native.controller.exportPdfPreparing, false)
  assert.equal(native.controller.exportWebView, null)
})

// Pagination is exercised against an actual browser by pdf-engine-browser.js.
// A geometry-only canvas mock cannot detect missing DOM, line breaks, or duplicate pages.

test("准备进度兼容真实的异步核心桥接响应", async () => {
  const native = nativeBridge(true)
  const result = native.dispatch("exportMistakes", { format: "pdf", recordIds: ["1"] })
  const status = await native.dispatch("pdfTaskStatus", { id: result.taskId })
  assert.equal(status.status, "preparing")
  assert.equal(status.progress, 18)
})

test("已选择导出的卡片评论始终展开，不受详情折叠状态影响", async () => {
  const { buildMistakePdfHtml } = await import("../src/mistake-export")
  const item = detail("comments")
  item.questionHtml = '<body><details class="card-comment"><summary>评论</summary><p>必须打印的评论</p></details></body>'
  assert.match(buildMistakePdfHtml([item], { format: "pdf", include: { comments: true } }), /<details class="card-comment" open>/)
})


test("已生成的任务不能再报告取消成功", () => {
  const native = nativeBridge()
  const response = native.dispatch("exportMistakes", { format: "pdf" })
  native.controller.exportPdfTask.status = "generated"
  assert.equal(native.dispatch("pdfTaskCancel", { id: response.taskId }).cancelled, false)
  assert.equal(native.controller.exportPdfTask.status, "generated")
})


test("完整预览已移除，直调后端也只能预览最多三题", async () => {
  const { previewMistakeExport } = await import("../src/mistake-export")
  records.push({ recordId: "four", noteAvailable: true }, { recordId: "five", noteAvailable: true })
  try {
    for (const previewLimit of [undefined, 999]) {
      calls.length = 0
      const result = await previewMistakeExport({ format: "md", recordIds: ["first", "last", "four", "five"], previewLimit })
      assert.equal(result.previewCount, 3)
      assert.equal(result.truncated, true)
      assert.equal(calls.length, 3)
    }
  } finally { records.splice(3) }
  assert.doesNotMatch(readFileSync("web/src/main.jsx", "utf8"), /完整预览|runPreview\(true\)/)
})


test("手写原始数据在共享绘制器前回填，批量 HTML 不再携带重复档案", async () => {
  const { previewMistakeExport } = await import("../src/mistake-export")
  includeDrawing = true
  files.clear()
  try {
    const result = await previewMistakeExport({ format: "pdf", recordIds: ["first", "last"] })
    assert.equal(result.pdfAssets.filter((asset: any) => /^(image|drawing)-/.test(asset.name)).length, 2)
    assert.doesNotMatch(result.html, /data-drawing="AP\/\+"/)
    let drawing = ""
    const images = [{ src: "" }]
    const canvas = { setAttribute: (name: string, value: string) => { assert.equal(name, "data-drawing"); drawing = value } }
    for (const [path, script] of files) if (!path.includes("/unit-")) runInNewContext(script, { document: { querySelectorAll: (selector: string) => selector.startsWith("canvas") ? [canvas] : images } })
    assert.equal(drawing, "AP/+")
    const drawingAsset = result.pdfAssets.find((asset: any) => asset.name.startsWith("drawing-"))
    assert.ok(drawingAsset)
    assert.match(result.html, /__MN_PDF_DRAW__/)
    assert.doesNotMatch(result.html, /src="\.\/drawing-/)
  } finally { includeDrawing = false }
})


test("分页任务按顺序冻结片段，集中答案保持题号，正文不留在主 HTML", async () => {
  const { exportMistakes } = await import("../src/mistake-export")
  files.clear()
  const result = await exportMistakes({ format: "pdf", recordIds: ["last", "bad", "first"], answerLayout: "end" })
  const manifest = JSON.parse(result.html.match(/window.__MN_PDF_MANIFEST__=(.*?);<\/script>/)[1])
  assert.deepEqual(manifest.units.map((unit: any) => [unit.kind, unit.index]), [["question", 0], ["question", 1], ["answer", 0], ["answer", 1]])
  const blocks = manifest.units.map((unit: any) => {
    const scope: any = { window: {} }
    runInNewContext(files.get(`${result.pdfSourceDirectory}/${unit.name}`)!, scope)
    return scope.window.__MN_PDF_UNIT__
  })
  assert.match(blocks[0], /<span>1\.<\/span><h1>last/)
  assert.match(blocks[1], /<span>2\.<\/span><h1>first/)
  assert.match(blocks[3], /答案 2/)
  assert.equal(result.count, 2)
  assert.equal(result.missing, 1)
  assert.doesNotMatch(result.html, /<h1>last|<h1>first/)
})

test("受理快照不随调用者修改，分页进度只作用于当前 WebView", () => {
  const native = nativeBridge()
  const payload = { format: "pdf", recordIds: ["1"], include: { answer: true } }
  const result = native.dispatch("exportMistakes", payload)
  payload.recordIds.push("2"); payload.include.answer = false
  const snapshot = native.dispatch("pdfTaskStatus", { id: result.taskId }).snapshot
  assert.deepEqual(Array.from(snapshot.recordIds), ["1"])
  assert.equal(snapshot.include.answer, true)
})

test("二进制按块编码保持字节、尾部 padding 和释放语义", () => {
  const source = readFileSync("web/pdf-export-runtime.js", "utf8").replace('  function checkCancelled() {', '  window.setBytes = function(value) { pdfBytes = value; }; function checkCancelled() {')
  const scope: any = { window: {}, document: {}, Uint8Array, Math, Number, Error, btoa: (value: string) => Buffer.from(value, "latin1").toString("base64") }
  runInNewContext(source, scope)
  for (const size of [1, 2, 3, 49151, 49152, 49153, 110001]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251)
    scope.window.setBytes(bytes)
    let encoded = ""
    for (let i = 0; i < Math.ceil(size / 49152); i++) encoded += scope.window.__MN_PDF_EXPORT_TAKE_CHUNK__(i)
    assert.deepEqual(Buffer.from(encoded, "base64"), Buffer.from(bytes))
  }
  scope.window.__MN_PDF_EXPORT_RELEASE__()
  assert.throws(() => scope.window.__MN_PDF_EXPORT_TAKE_CHUNK__(0), /已取消/)
})


test("准备阶段取消立即停止后续题卡，后续任务获得独立上下文", async () => {
  const { exportMistakes, cancelMistakeExportPreparation } = await import("../src/mistake-export")
  records.push(...["extra1", "extra2", "extra3"].map(recordId => ({ recordId, noteAvailable: true })))
  calls.length = 0
  delayHook = cancelMistakeExportPreparation
  try {
    await assert.rejects(exportMistakes({ format: "pdf", recordIds: ["first", "last", "extra1", "extra2", "extra3"] }), /已取消导出/)
    assert.equal(calls.length, 4)
    delayHook = undefined
    const result = await exportMistakes({ format: "pdf", recordIds: ["first"] })
    assert.equal(result.count, 1)
  } finally { delayHook = undefined; records.splice(3) }
})

test("资源暂存失败终止整个任务，不能报告成功并跳过题目", async () => {
  const { exportMistakes } = await import("../src/mistake-export")
  failWrite = true
  try { await assert.rejects(exportMistakes({ format: "pdf", recordIds: ["first", "last"] }), /disk-full/) }
  finally { failWrite = false }
})

test("PDF 公式使用 TeX 转 HTML，不能静默截图空白 MathML", async () => {
  const { buildMistakePdfHtml } = await import("../src/mistake-export")
  const item = detail("formula")
  item.questionHtml = '<math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math>'
  const html = buildMistakePdfHtml([item], { format: "pdf" })
  assert.match(html, /katex-html/)
  assert.doesNotMatch(html, /<math/)
  item.questionHtml = '<math><mi>x</mi></math>'
  assert.throws(() => buildMistakePdfHtml([item], { format: "pdf" }), /缺少 TeX/)
})
