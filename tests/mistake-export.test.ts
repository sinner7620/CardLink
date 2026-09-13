import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

Object.assign(globalThis, {
  Application: { sharedInstance: () => ({ appVersion: "4.0.0", osType: 1 }) },
  Database: { sharedInstance: () => ({}) },
  NSLocale: { preferredLanguages: () => ["zh-CN"] },
  UIColor: { colorWithHexString: (value: string) => value }
})

const exportModule = import("../src/mistake-export")

const detail: any = {
  record: {
    recordId: "book:question",
    sourceNoteId: "question",
    sourceNotebookId: "book",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "1994数一",
    sourcePathTitles: ["基本概念题"],
    categoryPath: ["多元微分", "基本概念题"],
    categoryLabel: "多元微分 › 基本概念题",
    level: 1,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z",
    lastReviewedAt: "2026-07-02T08:00:00.000Z",
    nextReviewAt: "2026-07-03T08:00:00.000Z",
    reviewCount: 1,
    history: [{ at: "2026-07-02T08:00:00.000Z", level: 1 }]
  },
  questionHtml: '<html><body><article><img src="data:image/png;base64,abc"><p>原题评论</p><canvas data-drawing="drawing"></canvas></article><script>renderDrawing()</script></body></html>',
  answers: [
    { title: "答案一", path: "答案脑图 › 第一解", html: "<html><body><p>第一种答案</p></body></html>" },
    { title: "答案二", path: "答案脑图 › 第二解", html: "<html><body><p>第二种答案</p></body></html>" }
  ],
  answerStatus: "ready"
}

const options: any = { format: "md", include: { question: true, answer: true, source: true, review: true } }

test("Markdown 导出使用标准 Markdown，不再泄露卡片 HTML、脚本或 drawing 原始数据", async () => {
  const { buildMistakeMarkdown } = await exportModule
  const markdown = buildMistakeMarkdown([detail], options)
  for (const value of ["多元微分", "![卡片图片](data:image/png;base64,abc)", "原题评论", "手写内容解析失败", "第一种答案", "第二种答案", "复习记录"]) {
    assert.match(markdown, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.doesNotMatch(markdown, /<script|data-drawing=|renderDrawing\(\)/)
  assert.match(markdown, /答案1\.1：答案一/)
  assert.match(markdown, /答案1\.2：答案二/)
})

test("PDF HTML 是分页、自包含且保留卡片绘制脚本", async () => {
  const { buildMistakePdfHtml } = await exportModule
  const html = buildMistakePdfHtml([detail], { ...options, format: "pdf" })
  assert.match(html, /@page\{size:A4/)
  assert.match(html, /page-break-before:always/)
  assert.match(html, /problem-title/)
  assert.match(html, /<span>1\.<\/span><h1>1994数一<\/h1>/)
  assert.match(html, /problem-source\">来源：多元微分 › 基本概念题/)
  assert.match(html, /writing-space/)
  assert.match(html, /renderDrawing\(\)/)
  assert.match(html, /第一种答案/)
  assert.match(html, /第二种答案/)
  assert.match(html, /答案1\.1 · 答案一/)
  assert.match(html, /答案1\.2 · 答案二/)
  assert.doesNotMatch(html, /解法 [12]/)
  assert.doesNotMatch(html, />原题卡片</)
  assert.doesNotMatch(html, /原卡片 ID|原脑图 ID/)
  assert.match(html, /__MN_PDF_EXPORT_BEGIN__/)
  assert.match(html, /__MN_PDF_EXPORT_PROTOCOL_V2__/)
  assert.match(html, /waitForImages/)
  assert.match(html, /markBrokenImage/)
  assert.match(html, /data-pdf-image-error/)
  assert.match(html, /waitForStableLayout/)
  assert.match(html, /canvasFingerprint/)
  assert.match(html, /signal\("pdf-render-ready"\)/)
  assert.match(html, /pdf-render-error/)
  assert.doesNotMatch(html, /createElement\("iframe"\)|data-pdf-control/)
  assert.match(html, /window\.location\.href="mnaddon:\/\/"\+name/)
})

test("PDF 答案位置支持紧随每题与文末集中", async () => {
  const { buildMistakePdfHtml } = await exportModule
  const second = {
    ...detail,
    record: { ...detail.record, recordId: "book:question-2", sourceNoteId: "question-2", sourceTitle: "1995数一" }
  }
  // 紧随每题：题目1 → 答案1 → 题目2 → 答案2
  const afterEach = buildMistakePdfHtml([detail, second], { ...options, format: "pdf", pageLayout: "auto", answerLayout: "after-each" })
  assert.ok(afterEach.indexOf("<span>1.</span><h1>1994数一") < afterEach.indexOf("<span>答案 1</span><h1>1994数一"))
  assert.ok(afterEach.indexOf("<span>答案 1</span><h1>1994数一") < afterEach.indexOf("<span>2.</span><h1>1995数一"))
  assert.ok(afterEach.indexOf("<span>2.</span><h1>1995数一") < afterEach.indexOf("<span>答案 2</span><h1>1995数一"))

  // 文末集中：答案位于最后一个题目内容之后
  const atEnd = buildMistakePdfHtml([detail, second], { ...options, format: "pdf", pageLayout: "one-per-page", answerLayout: "end" })
  assert.ok(atEnd.indexOf("<span>2.</span><h1>1995数一") < atEnd.indexOf("<span>答案 1</span><h1>1994数一"))
})

test("PDF 支持自动、一页一题、一页两题和一页三题布局", async () => {
  const { buildMistakePdfHtml } = await exportModule
  const details = [0, 1, 2, 3].map(index => ({
    ...detail,
    record: { ...detail.record, recordId: `book:q-${index}`, sourceNoteId: `q-${index}`, sourceTitle: `题目${index + 1}` }
  }))
  const automatic = buildMistakePdfHtml(details, { ...options, format: "pdf", include: { ...options.include, answer: false }, pageLayout: "auto" })
  assert.match(automatic, /<body class="layout-auto">/)
  assert.match(automatic, /pdf-flow \.pdf-slot\+\.pdf-slot\{margin-top:1\.55em\}/)
  assert.match(automatic, /class="pdf-flow pdf-question-flow"/)
  assert.doesNotMatch(automatic, /<section class="pdf-page/)

  for (const [layout, slots, pages] of [["one-per-page", 1, 4], ["two-per-page", 2, 2], ["three-per-page", 3, 2]] as const) {
    const html = buildMistakePdfHtml(details, { ...options, format: "pdf", include: { ...options.include, answer: false }, pageLayout: layout })
    assert.match(html, new RegExp(`<body class="layout-${layout}">`))
    assert.equal((html.match(new RegExp(`<section class="pdf-page slots-${slots}">`, "g")) || []).length, pages)
  }

  const twoPerPageWithAnswers = buildMistakePdfHtml(details, { ...options, format: "pdf", answerLayout: "end", pageLayout: "two-per-page" })
  assert.equal((twoPerPageWithAnswers.match(/<section class="pdf-page slots-2">/g) || []).length, 2)
  assert.equal((twoPerPageWithAnswers.match(/<section class="pdf-flow pdf-answer-flow">/g) || []).length, 1)
  assert.ok(twoPerPageWithAnswers.lastIndexOf("<section class=\"pdf-page slots-2\">") < twoPerPageWithAnswers.indexOf("<section class=\"pdf-flow pdf-answer-flow\">"))
  assert.match(twoPerPageWithAnswers, /answer-content figure\.drawing\{width:auto!important;max-width:46%!important/)
})

test("PDF 紧凑密度按 60% 宽度呈现卡片，答案位置沿用所选布局", async () => {
  const { buildMistakePdfHtml } = await exportModule
  const details = Array.from({ length: 12 }, (_, index) => ({
    ...detail,
    record: { ...detail.record, recordId: `book:q-${index}`, sourceNoteId: `q-${index}`, sourceTitle: `题目${index + 1}` }
  }))
  const html = buildMistakePdfHtml(details, { ...options, format: "pdf", pageLayout: "compact", answerLayout: "end" })
  assert.match(html, /<body class="layout-compact">/)
  assert.match(html, /class="pdf-flow pdf-question-flow"/)
  assert.match(html, /class="pdf-flow pdf-answer-flow"/)
  assert.doesNotMatch(html, /<section class="pdf-page/)
  assert.equal((html.match(/class="mistake question-unit"/g) || []).length, 12)
  assert.match(html, /layout-compact \.card-content,\.layout-compact \.answer-content\{width:60%;min-width:0\}/)
  assert.match(html, /layout-compact \.card-content \.text-block[^}]*font-size:11px/)
  assert.match(html, /layout-compact \.card-content p,\.layout-compact \.answer-content p\{margin:2px 0\}/)
  const after = buildMistakePdfHtml(details, { ...options, format: "pdf", pageLayout: "compact", answerLayout: "after-each" })
  assert.match(after, /class="pdf-flow pdf-compact-flow"/)
  assert.equal((after.match(/class="mistake answer-unit"/g) || []).length, 12)
})

test("PDF 卡片正文移除卡片自身标题，避免与题目名重复", async () => {
  const { buildMistakePdfHtml } = await exportModule
  const titled = {
    ...detail,
    questionHtml: '<html><body><iframe src="mnaddon://control">乱码</iframe><article class="card"><div class="eyebrow">题目</div><h1>重复标题</h1><p>正文保留</p></article></body></html>'
  }
  const html = buildMistakePdfHtml([titled], { ...options, format: "pdf" })
  assert.doesNotMatch(html, /重复标题/)
  assert.doesNotMatch(html, /<iframe|mnaddon:\/\/control|乱码/)
  assert.match(html, /正文保留/)
})

test("Markdown 压缩包会把 data URI 改写为有限长度的 assets 路径", async () => {
  const { extractMarkdownAssets } = await exportModule
  const bundle = extractMarkdownAssets("![题图](data:image/png;base64,aGVsbG8=)\n![手写](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)")
  assert.equal(bundle.assets.length, 2)
  assert.equal(bundle.assets[0].fileName, "asset-0001.png")
  assert.equal(bundle.assets[1].fileName, "asset-0002.svg")
  assert.match(bundle.markdown, /!\[题图\]\(assets\/asset-0001\.png\)/)
  assert.match(bundle.markdown, /!\[手写\]\(assets\/asset-0002\.svg\)/)
  assert.doesNotMatch(bundle.markdown, /data:image|base64/)
})

test("图片扩展名按真实文件头识别，不信任错误的 jpeg MIME", async () => {
  const { extractMarkdownAssets } = await exportModule
  const bundle = extractMarkdownAssets("![题图](data:image/jpeg;base64,iVBORw0KGgo=)")
  assert.equal(bundle.assets[0].fileName, "asset-0001.png")
  assert.match(bundle.markdown, /assets\/asset-0001\.png/)
})

test("MarginNote 图片使用媒体 ID 写出，不调用 NSData base64 解码", async () => {
  const { extractMarkdownAssets } = await exportModule
  const bundle = extractMarkdownAssets("![题图](mnmedia://png/abc123)")
  assert.equal(bundle.assets[0].mediaId, "abc123")
  assert.equal(bundle.assets[0].fileName, "asset-0001.png")
  assert.match(bundle.markdown, /assets\/asset-0001\.png/)
})

test("MarginNote markdownimg 图片使用媒体 ID 写出", async () => {
  const { extractMarkdownAssets } = await exportModule
  const bundle = extractMarkdownAssets("![题目图片 1](marginnote4app://markdownimg/png/410b3288f3673b1260db964c4e789625)")
  assert.deepEqual(bundle.assets, [{
    fileName: "asset-0001.png",
    mediaId: "410b3288f3673b1260db964c4e789625"
  }])
  assert.match(bundle.markdown, /!\[题目图片 1\]\(assets\/asset-0001\.png\)/)
})

test("PDF 导出只使用当前文档确认的 WebView、NSData 与 saveFileWithUti 边界", () => {
  const bridge = readFileSync("rails-native/WebBridgeCommands.js", "utf8")
  assert.match(bridge, /stagePdfRenderPage/)
  assert.match(bridge, /CardLink\/temp/)
  assert.match(bridge, /pdf-runtime"/)
  assert.match(bridge, /NSData\.dataWithStringEncoding\(preparePdfHtml\(html, previewMode\), 4\)/)
  assert.match(bridge, /<script src="\.\/html2canvas\.min\.js"><\/script>/)
  assert.match(bridge, /<script src="\.\/jspdf\.umd\.min\.js"><\/script>/)
  assert.match(bridge, /<script src="\.\/pdf-export-runtime\.js"><\/script>/)
  assert.match(bridge, /loadRequest\(NSURLRequest\.requestWithURL\(entry\)\)/)
  assert.match(bridge, /__MN_PDF_FILE_FALLBACK_BEGIN__/)
  assert.match(bridge, /__MN_PDF_EXPORT_TAKE_CHUNK__/)
  assert.match(bridge, /NSData\.dataWithStringEncoding\(binary, 5\)/)
  assert.match(bridge, /writeToFileAtomically/)
  assert.match(bridge, /saveFileWithUti\(path, "com\.adobe\.pdf"\)/)
  assert.match(bridge, /pdfGenerated: true/)
  assert.doesNotMatch(bridge, /dataWithBase64EncodedStringOptions/)
  assert.doesNotMatch(bridge, /viewPrintFormatter|UIPrintInteractionController|window\.print/)
  assert.doesNotMatch(bridge, /UIGraphicsBeginPDF|UIGraphicsEndPDF/)

  const runtime = readFileSync("web/pdf-export-runtime.js", "utf8")
  assert.match(runtime, /window\.html2canvas/)
  assert.match(runtime, /window\.jspdf\.jsPDF/)
  assert.match(runtime, /pdf\.output\("arraybuffer"\)/)
  assert.match(runtime, /Math\.max\(2\.5, Math\.min\(3, pixelRatio \* 1\.5\)\)/)
  assert.match(runtime, /image\/jpeg", 0\.97/)
  assert.match(runtime, /undefined, "SLOW"/)
  assert.match(runtime, /__MN_PDF_FILE_FALLBACK_BEGIN__/)
  assert.match(runtime, /mnaddon:\/\/" \+ name/)
  assert.match(runtime, /querySelectorAll\("\.pdf-page, \.pdf-flow"\)/)
  assert.match(runtime, /node\.classList\.contains\("pdf-page"\)/)
  assert.doesNotMatch(runtime, /querySelectorAll\("\.cover, \.mistake"\)/)
  assert.match(runtime, /ignoreElements/)
  assert.match(runtime, /element\.tagName === "IFRAME"/)
  assert.match(runtime, /querySelectorAll\("iframe, \[data-pdf-control\]"\)/)
  assert.match(runtime, /previewPageLengths/)
  assert.match(runtime, /__MN_PDF_EXPORT_TAKE_PREVIEW_CHUNK__/)

  assert.match(bridge, /renderPdfPreview/)
  assert.match(bridge, /MN4错题导出预览\.pdf/)
  assert.match(bridge, /pdfPreview: true/)
  assert.match(bridge, /pullPdfPreviewPages/)
  assert.match(bridge, /preview-page-" \+ \(pageIndex \+ 1\) \+ "\.jpg/)
  assert.match(bridge, /cleanupPdfArtifacts\(root, manager\)/)
  assert.match(bridge, /pdf-cache/)
  assert.match(bridge, /\["beta33", "beta34", "beta35", "beta36"\]/)
  assert.match(bridge, /for \(var index = 1; index <= 200; index \+= 1\)/)
  assert.doesNotMatch(bridge, /createElement\("iframe"\)/)

  const panel = readFileSync("rails-native/WebPanelController.js", "utf8")
  assert.match(panel, /mnaddon:\/\/pdf-render-ready/)
  assert.match(panel, /mnaddon:\/\/pdf-data-ready/)
  assert.match(panel, /pdfDataReady/)
  assert.match(panel, /pdfRenderError/)
})

test("导出页按需生成真实 PDF 预览并在选项变化后失效旧预览", () => {
  const core = readFileSync("src/rails-core.ts", "utf8")
  const exporter = readFileSync("src/mistake-export.ts", "utf8")
  const ui = readFileSync("web/src/main.jsx", "utf8")
  assert.match(core, /previewMistakeExport/)
  assert.match(exporter, /renderPdfPreview: true/)
  assert.match(ui, /action\("previewMistakeExport"/)
  assert.match(ui, /生成快速预览/)
  assert.match(ui, /actualPreview\?\.previewPages\?\.length/)
  assert.match(ui, /PDF 第 \$\{index \+ 1\} 页/)
  assert.match(ui, /actualPreviewPages/)
  assert.match(ui, /setActualPreview\(null\)/)
})

test("PDF 导出栏显示原生进度并可立即停止隐藏渲染任务", () => {
  const ui = readFileSync("web/src/main.jsx", "utf8")
  const bridge = readFileSync("rails-native/WebBridgeCommands.js", "utf8")
  assert.match(ui, /role="progressbar"/)
  assert.match(ui, />停止导出</)
  assert.match(ui, /status\.progress/)
  assert.match(bridge, /progress: 5/)
  assert.match(bridge, /task\.status = "cancelled"/)
  assert.match(bridge, /releasePdfRequest\(context\.controller\)/)
})

test("ZIP 导出调用 MN4 全局 ZipArchive，而不是 marginnote 模块属性", () => {
  const source = readFileSync("src/mistake-export.ts", "utf8")
  assert.doesNotMatch(source, /import\s*\{[^}]*ZipArchive[^}]*\}\s*from\s*["']marginnote["']/)
  assert.match(source, /ZipArchive\.createZipFileAtPathWithContentsOfDirectory/)
})

test("导出准备阶段可取消：分批循环与图片写入段都有取消检查点", () => {
  const source = readFileSync("src/mistake-export.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const ui = readFileSync("web/src/main.jsx", "utf8")
  assert.match(source, /export function cancelMistakeExportPreparation/)
  assert.match(source, /function ensureNotCancelled[\s\S]*?已取消导出/)
  assert.match(source, /await delay\(0\.01\)\s*ensureNotCancelled\(\)/)
  assert.match(source, /async function saveMarkdownBundle/)
  assert.match(source, /exportCancelled = false/)
  assert.match(core, /command === "cancelMistakeExportPreparation"/)
  assert.match(ui, /MNBridge\.send\("cancelMistakeExportPreparation"\)/)
})

test("Markdown 目录名精确到毫秒，清理按目录+zip 同批次分组计数", () => {
  const source = readFileSync("src/mistake-export.ts", "utf8")
  assert.match(source, /function exportStamp[\s\S]*?getMilliseconds\(\)/)
  assert.match(source, /const stamp = exportStamp\(\)/)
  assert.match(source, /key: name\.replace\(\/\\\.zip\$\/i, ""\)/)
  assert.match(source, /keptGroups\.size < KEEP_EXPORTS/)
})

test("Preview 协议与真机一致：after-each/end 取值且空 recordIds 严格零道", () => {
  const preview = readFileSync("web/src/lib/previewBridge.js", "utf8")
  assert.doesNotMatch(preview, /questions-first|interleaved/)
  assert.match(preview, /answerLayout === "end"/)
  assert.match(preview, /answerLayout === "after-each"/)
  assert.match(preview, /const exportIds = \(payload\?\.recordIds \|\| \[\]\)\.map\(String\)/)
  assert.match(preview, /records\.filter\(item => exportIds\.includes\(item\.recordId\)\)/)
})

test("快速预览丢弃过期响应：签名不一致不写回旧预览", () => {
  const ui = readFileSync("web/src/main.jsx", "utf8")
  assert.match(ui, /const previewSignatureRef = useRef\(previewSignature\)/)
  assert.match(ui, /const signature = previewSignatureRef\.current/)
  assert.match(ui, /previewSignatureRef\.current !== signature\) return/)
})
