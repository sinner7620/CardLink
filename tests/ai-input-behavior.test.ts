import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { packAnalysisItems, planQuestionInput, preparationPolicyFingerprint, preparedInputMatches, type PreparationPolicy } from "../src/ai-input"

const policy: PreparationPolicy = {
  privacy: { images: "when-needed", handwriting: false, mindMapHandwriting: false }, ocrEngine: "glm-ocr",
  mineru: { enabled: true, policy: "auto", baseUrl: "https://ocr.test", language: "ch", enableFormula: true, enableTable: true },
  glmOcr: { baseUrl: "https://ocr.test", model: "glm-ocr" }
}
const card = (content: string) => `<html><body><article class="card"><div class="eyebrow">原题</div><h1>题目标题</h1>${content}</article></body></html>`
const picture = '<figure class="paint-note"><img src="data:image/png;base64,aW1hZ2U=" /><canvas data-drawing="ZHJhd2luZw==" data-drawing-overlay="true"></canvas></figure>'

test("禁止图片会移除图像与笔迹；卡片手写和脑图手写分别控制", () => {
  const raw = card(`<p>题干文字</p>${picture}`)
  const disabled = planQuestionInput(raw, { ...policy, privacy: { images: "never", handwriting: true, mindMapHandwriting: true } }, card(picture))
  assert.equal(disabled.needsOCR, false)
  assert.doesNotMatch(disabled.html, /<img|<canvas/)
  assert.match(disabled.nativeText, /题干文字/)
  const noDrawing = planQuestionInput(raw, policy)
  assert.match(noDrawing.html, /<img/)
  assert.doesNotMatch(noDrawing.html, /<canvas/)
  const boundOnly = planQuestionInput(raw, { ...policy, privacy: { ...policy.privacy, mindMapHandwriting: true } }, '<body><canvas data-drawing="Ym91bmQ="></canvas></body>')
  assert.match(boundOnly.html, /Ym91bmQ=/)
  assert.doesNotMatch(boundOnly.html, /ZHJhd2luZw==/)
})

test("OCR 策略按内容和上传权限执行，标题不算图片题的题干文字", () => {
  const imageOnly = card('<img src="data:image/png;base64,aW1hZ2U=" />')
  const mixed = card('<p>题干</p><img src="data:image/png;base64,aW1hZ2U=" />')
  const textOnly = card('<p>题干</p>')
  for (const engine of ["mineru", "glm-ocr"] as const) {
    const settings = { ...policy, ocrEngine: engine }
    assert.equal(planQuestionInput(imageOnly, settings).needsOCR, true)
    assert.equal(planQuestionInput(textOnly, settings).needsOCR, false)
    const only = { ...settings, mineru: { ...settings.mineru, policy: "image-only" as const } }
    assert.equal(planQuestionInput(imageOnly, only).needsOCR, true)
    assert.equal(planQuestionInput(mixed, only).needsOCR, false)
    const all = { ...settings, privacy: { ...settings.privacy, images: "always" as const }, mineru: { ...settings.mineru, policy: "all" as const } }
    assert.equal(planQuestionInput(textOnly, all).needsOCR, true)
    assert.equal(planQuestionInput(mixed, { ...all, mineru: { ...all.mineru, policy: "never" } }).needsOCR, false)
    assert.equal(planQuestionInput(mixed, { ...all, mineru: { ...all.mineru, enabled: false } }).needsOCR, false)
    assert.equal(planQuestionInput(mixed, { ...all, privacy: { ...all.privacy, images: "never" } }).needsOCR, false)
  }
})

test("旧混合缓存不能复用；来源、手写策略或 OCR 配置变化使缓存失效", () => {
  const identity = { sourceFingerprint: "source-1", policyFingerprint: preparationPolicyFingerprint(policy) }
  const snapshot = { schemaVersion: 3, status: "ready", questionText: "OCR", ...identity }
  assert.equal(preparedInputMatches(snapshot, identity), true)
  assert.equal(preparedInputMatches({ ...snapshot, schemaVersion: 2 }, identity), false)
  assert.equal(preparedInputMatches(snapshot, { ...identity, sourceFingerprint: "source-2" }), false)
  const changed = { ...policy, privacy: { ...policy.privacy, handwriting: true } }
  assert.equal(preparedInputMatches(snapshot, { ...identity, policyFingerprint: preparationPolicyFingerprint(changed) }), false)
  assert.notEqual(preparationPolicyFingerprint(policy), preparationPolicyFingerprint({ ...policy, glmOcr: { ...policy.glmOcr, baseUrl: "https://new.test" } }))
})

test("按完整题目预算装包，引用与实际正文严格对应，超长题不截半", () => {
  const items = [
    { reference: "Q001", recordId: "one", text: "Q001\n完整一" },
    { reference: "Q002", recordId: "two", text: "Q002\n" + "长".repeat(100) },
    { reference: "Q003", recordId: "three", text: "Q003\n完整三" }
  ]
  const packed = packAnalysisItems(items, 20)
  assert.equal(packed.text, items[0].text + "\n\n" + items[2].text)
  assert.deepEqual(packed.evidence, { Q001: "one", Q003: "three" })
  assert.equal(packed.omitted, 1)
  assert.equal(packAnalysisItems(items, 1).selected.length, 0)
})

// 下列测试执行真实 aiBridge、任务循环、请求组装和文件写入路径，仅替换原生边界。
const files = new Map<string, string>(), kv: Record<string, any> = {}, records: Record<string, any> = {}, html: Record<string, string> = {}
let sketch: any = null
let drawingBytes = "ZHJhd2luZw=="
type Request = { url: string; body: any; complete: (json: any, status?: number) => void }
const requests: Request[] = []
let onRequest: (request: Request) => void = request => request.complete({})
const runtime = globalThis as any
runtime.NSFileManager = { defaultManager: () => ({ fileExistsAtPath: () => true,
  createDirectoryAtPathWithIntermediateDirectoriesAttributes: () => true }) }
runtime.NSData = { dataWithStringEncoding: (value: string) => ({ value, writeToFileAtomically: (path: string) => { files.set(path, value); return true } }) }
runtime.NSURL = { URLWithString: (url: string) => url }
runtime.NSMutableURLRequest = { requestWithURL: (url: string) => ({ url, body: undefined, setHTTPMethod() {}, setTimeoutInterval() {}, setValueForHTTPHeaderField() {}, setHTTPBody(data: any) { this.body = JSON.parse(data.value) } }) }
runtime.NSOperationQueue = { mainQueue: () => ({}) }
runtime.NSJSONSerialization = { JSONObjectWithDataOptions: (data: any) => data }
runtime.NSURLConnection = { sendAsynchronousRequestQueueCompletionHandler: (request: any, _queue: any, callback: any) => {
  const item = { url: request.url, body: request.body, complete: (json: any, status = 200) => callback({ statusCode: status }, json, null) }
  requests.push(item); onRequest(item)
} }
mock.module("marginnote", { namedExports: {
  MN: { db: { allNotebooks: () => [{ topicId: "book", title: "学习集" }], getSketchNoteForMindMapFocusNoteId: () => sketch,
    getMediaByHash: () => ({ base64Encoding: () => drawingBytes }) } },
  NSJSONReadingOptions: { FragmentsAllowed: 0 }, UIAlertViewStyle: {}, popup: async () => ({}), isNSNull: () => false,
  getLocalDataByKey: (key: string) => kv[key], setLocalDataByKey: (value: any, key: string) => { kv[key] = value },
  isfileExists: (path: string) => files.has(path), readJSON: (path: string) => JSON.parse(files.get(path)!),
  writeTextFile: (path: string, value: string) => { files.set(path, value) },
  delay: (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds >= 1 ? 5 : 0))
} })
mock.module("../src/mistake-store", { namedExports: { loadMistakeState: () => ({ records }) } })
mock.module("../src/mistake-manager", { namedExports: {
  createMistakeContentReader: () => ({ readQuestion: (id: string) => { if (!html[id]) throw new Error("不可读"); return { questionHtml: html[id] } }, read: () => ({ answers: [] }) }),
  openSourceByMistakeId: () => ({})
} })
mock.module("../src/note-tree", { namedExports: { isMindMapNotebook: () => true } })
mock.module("../src/storage-paths", { namedExports: { cardLinkDocumentPath: (path: string) => `/test/${path}`, cardLinkTempPath: (path: string) => `/temp/${path}` } })
let bridge: typeof import("../src/ai-subsystem").aiBridge
const response = (evidence = ["Q001"]) => ({ choices: [{ message: { content: JSON.stringify({ summary: "报告", strengths: [], weakPoints: [{ title: "问题", reason: "依据", evidence }], errorPatterns: [], reviewAdvice: [], limitations: [] }) } }] })
async function reset() {
  bridge ||= (await import("../src/ai-subsystem")).aiBridge
  files.clear(); requests.length = 0; sketch = null; drawingBytes = "ZHJhd2luZw=="
  for (const object of [records, html]) for (const key of Object.keys(object)) delete object[key]
  kv["mn4-answer-matcher.ai.credentials.v1"] = { llm: "test", "ocr-glm": "test" }
  const settings = { ...policy, enabled: true, defaultProfileId: "llm",
    profiles: [{ id: "llm", type: "deepseek", name: "Test", model: "test", baseUrl: "https://llm.test", credentialRef: "llm" }],
    subjects: [{ id: "subject", name: "科目", studySetIds: ["book"], schedule: { enabled: false } }],
    privacy: { ...policy.privacy, includeAnswer: false } }
  await bridge("aiSaveSettings", settings)
  onRequest = request => request.complete(request.url.includes("layout_parsing") ? { md_results: "识别后的题目与手写" } : response())
  return settings
}
function add(id = "one", content = card("<p>题干文字</p>")) {
  records[id] = { recordId: id, sourceNoteId: id, sourceNotebookId: "book", sourceTitle: "题目", sourceNotebookTitle: "学习集",
    sourcePathTitles: [], manualCategories: [], level: 0, reviewCount: 1, history: [], updatedAt: "2026-09-13" }
  html[id] = content
}
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)) }
  throw new Error("任务未在测试期限内结束")
}
async function analyze() { return bridge("aiStartAnalysis", { subjectId: "subject" }) }
async function finished(id: string) {
  await until(async () => ["done", "failed", "cancelled"].includes((await bridge("aiGetJob", { jobId: id })).status))
  return bridge("aiGetJob", { jobId: id })
}
async function prepare() {
  const job = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  const input = await bridge("aiGetPreparationQuestion", { jobId: job.id, recordId: "one" })
  if (!input.nativeOnly) {
    await bridge("aiSubmitPreparationImage", { jobId: job.id, recordId: "one", imageDataUri: "data:image/jpeg;base64,aW1hZ2U=" })
    await until(async () => (await bridge("aiGetQuestionPreparationJob", { jobId: job.id })).status === "done")
  }
  return { job, input }
}

test("真实准备流程在禁止图片时无请求，纯文字分析不依赖旧 OCR", async () => {
  const settings = await reset(); add("one", card(`<p>原生文字</p>${picture}`))
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, images: "never", handwriting: true } })
  const { input } = await prepare()
  assert.equal(input.nativeOnly, true)
  assert.equal(requests.length, 0)
  const localSnapshot = JSON.parse([...files.values()][0])
  assert.equal(localSnapshot.schemaVersion, 3)
  assert.equal(localSnapshot.provider, "local")
  const job = await finished((await analyze()).id)
  assert.equal(job.status, "done")
  assert.match(requests[0].body.messages[1].content, /原生文字/)
  assert.doesNotMatch(JSON.stringify(requests[0].body), /base64|ZHJhd2luZw|手写解析失败/)
})

test("真实请求拒绝旧缓存和变化来源，重做后可用，关闭脑图手写不沿用混合文字", async () => {
  const settings = await reset(); add("one", card(`<p>原生文字</p>${picture}`)); sketch = { drawing: "hash" }
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, mindMapHandwriting: true } })
  const { input } = await prepare()
  assert.match(input.questionHtml, /mindmap-hash/)
  assert.equal(requests.filter(r => r.url.includes("layout_parsing")).length, 1)
  assert.equal((await finished((await analyze()).id)).status, "done")
  const sent = requests.filter(r => r.url.includes("llm")); assert.match(sent[0].body.messages[1].content, /识别后的题目与手写/)
  drawingBytes = "Y2hhbmdlZA=="
  assert.equal((await finished((await analyze()).id)).status, "failed")
  assert.equal(requests.filter(r => r.url.includes("llm")).length, 1)
  await prepare()
  html.one = card(`<p>改题干</p>${picture}`)
  assert.equal((await finished((await analyze()).id)).status, "failed")
  await bridge("aiSaveSettings", settings)
  assert.equal((await finished((await analyze()).id)).status, "failed")
  assert.equal(requests.filter(r => r.url.includes("llm")).length, 1)
  await prepare()
  assert.equal((await finished((await analyze()).id)).status, "done")
  const entry = [...files.entries()].find(([path]) => path.includes("/records/"))!
  files.set(entry[0], JSON.stringify({ ...JSON.parse(entry[1]), schemaVersion: 2 }))
  assert.equal((await finished((await analyze()).id)).status, "failed")
})

test("截图后改设置会取消准备，不能继续上传", async () => {
  const settings = await reset(); add("one", card(picture))
  const prep = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  await bridge("aiGetPreparationQuestion", { jobId: prep.id, recordId: "one" })
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, images: "never" } })
  await assert.rejects(bridge("aiSubmitPreparationImage", { jobId: prep.id, recordId: "one", imageDataUri: "data:image/jpeg;base64,aW1hZ2U=" }), /已取消/)
  assert.equal(requests.length, 0)
})

test("截图后改原题阻止上传；OCR 返回期间改手写不能保存新快照", async () => {
  const settings = await reset(); add("one", card(picture)); sketch = { drawing: "hash" }
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, mindMapHandwriting: true } })
  const prep = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  await bridge("aiGetPreparationQuestion", { jobId: prep.id, recordId: "one" })
  html.one = card(`<p>已改题干</p>${picture}`)
  await assert.rejects(bridge("aiSubmitPreparationImage", { jobId: prep.id, recordId: "one", imageDataUri: "data:image/jpeg;base64,aW1hZ2U=" }), /已变化/)
  assert.equal(requests.length, 0)
  await bridge("aiCancelQuestionPreparation", { jobId: prep.id })
  const next = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  await bridge("aiGetPreparationQuestion", { jobId: next.id, recordId: "one" })
  let pending: Request | undefined
  onRequest = request => { pending = request }
  await bridge("aiSubmitPreparationImage", { jobId: next.id, recordId: "one", imageDataUri: "data:image/jpeg;base64,aW1hZ2U=" })
  await until(async () => !!pending)
  drawingBytes = "Y2hhbmdlZA=="
  pending!.complete({ md_results: "旧手写结果" })
  await until(async () => (await bridge("aiGetQuestionPreparationJob", { jobId: next.id })).status === "done")
  assert.equal((await bridge("aiGetQuestionPreparationJob", { jobId: next.id })).failed, 1)
  assert.equal([...files.keys()].some(path => path.includes("/records/")), false)
})

test("取消已发出的 OCR 后不写缓存或题目快照", async () => {
  await reset(); add("one", card(picture))
  const prep = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  await bridge("aiGetPreparationQuestion", { jobId: prep.id, recordId: "one" })
  let pending: Request | undefined
  onRequest = request => { pending = request }
  await bridge("aiSubmitPreparationImage", { jobId: prep.id, recordId: "one", imageDataUri: "data:image/jpeg;base64,aW1hZ2U=" })
  await until(async () => !!pending)
  await bridge("aiCancelQuestionPreparation", { jobId: prep.id })
  pending!.complete({ md_results: "不应保存" })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(files.size, 0)
  assert.equal((await bridge("aiGetQuestionPreparationJob", { jobId: prep.id })).status, "cancelled")
})

test("分析请求取消后的成功和失败响应都不能写报告或改成 failed/done", async () => {
  for (const status of [200, 500]) {
    await reset(); add()
    let pending: Request | undefined
    onRequest = request => { pending = request }
    const job = await analyze()
    await until(async () => !!pending)
    await bridge("aiCancelJob", { jobId: job.id })
    pending!.complete(status === 200 ? response() : { error: { message: "失败" } }, status)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal((await finished(job.id)).status, "cancelled")
    assert.equal([...files.keys()].some(path => path.includes("/reports/")), false)
  }
})

test("关闭再打开总开关不能恢复已取消请求的保存；取消准备阶段不发模型请求", async () => {
  const settings = await reset(); add()
  let pending: Request | undefined
  onRequest = request => { pending = request }
  const job = await analyze()
  await until(async () => !!pending)
  await bridge("aiSaveSettings", { ...settings, enabled: false })
  await bridge("aiSaveSettings", settings)
  pending!.complete(response())
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal((await finished(job.id)).status, "cancelled")
  assert.equal([...files.keys()].some(path => path.includes("/reports/")), false)
  requests.length = 0
  const next = await analyze()
  await bridge("aiCancelJob", { jobId: next.id })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(requests.length, 0)
})

test("真实报告引用排除读取失败与容量外题目，覆盖数等于实际请求", async () => {
  await reset()
  add("one")
  add("two", card(`<p>${"长".repeat(120000)}</p>`))
  add("three", "")
  onRequest = request => request.complete(response(["Q001", "Q002", "Q003", "toString"]))
  const job = await finished((await analyze()).id)
  assert.equal(job.status, "done")
  const prompt = requests[0].body.messages[1].content
  assert.ok(prompt.length <= 120000)
  assert.doesNotMatch(prompt, /Q002|Q003/)
  const report = await bridge("aiGetReport", { reportId: job.reportId })
  assert.deepEqual(report.evidence, { Q001: "one" })
  assert.deepEqual(report.content.weakPoints[0].evidence, ["Q001"])
  assert.equal(report.coverage.analyzed, 1)
  assert.equal(report.coverage.budgetOmitted, 1)
  assert.equal(report.coverage.unavailable, 1)
})
