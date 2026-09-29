import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { packAnalysisItems, planQuestionInput, preparationPolicyFingerprint, preparedInputMatches, analysisUserContent, type PreparationPolicy } from "../src/ai-input"

const policy: PreparationPolicy = {
  privacy: { handwriting: false }, ocrEngine: "glm-ocr",
  mineru: { enabled: true, baseUrl: "https://ocr.test", language: "ch", enableFormula: true, enableTable: true },
  glmOcr: { baseUrl: "https://ocr.test", model: "glm-ocr" }
}
const card = (content: string) => `<html><body><article class="card"><div class="eyebrow">原题</div><h1>题目标题</h1>${content}</article></body></html>`
const picture = '<figure class="paint-note"><img src="data:image/png;base64,aW1hZ2U=" /><canvas data-drawing="ZHJhd2luZw==" data-drawing-overlay="true"></canvas></figure>'

test("OCR 截图永远不含手写；开启手写内容时渲染版保留手写供独立捕获", () => {
  const raw = card(`<p>题干文字</p>${picture}`)
  const plain = planQuestionInput(raw, policy)
  assert.match(plain.ocrHtml, /<img/)
  assert.doesNotMatch(plain.ocrHtml, /<canvas/)
  assert.equal(plain.html, plain.ocrHtml)
  assert.equal(plain.needsOCR, true)
  const withHandwriting = planQuestionInput(raw, { ...policy, privacy: { handwriting: true } }, '<body><section class="bound-mindmap-handwriting">Ym91bmQ=</section></body>')
  assert.match(withHandwriting.html, /<canvas[^>]*ZHJhd2luZw==/)
  assert.match(withHandwriting.html, /Ym91bmQ=/)
  assert.doesNotMatch(withHandwriting.ocrHtml, /<canvas|Ym91bmQ=/)
})

test("有题干文字直接读取，含图片才需要 OCR", () => {
  const textCard = card("<p>题干文字</p>")
  const imageCard = card('<img src="data:image/png;base64,aW1hZ2U=" />')
  const plain = planQuestionInput(textCard, policy)
  assert.equal(plain.needsOCR, false)
  assert.equal(plain.hasText, true)
  assert.match(plain.nativeText, /题干文字/)
  const withImage = planQuestionInput(imageCard, policy)
  assert.equal(withImage.needsOCR, true)
  assert.equal(withImage.hasMedia, true)
  const ocrOff = planQuestionInput(imageCard, { ...policy, mineru: { ...policy.mineru, enabled: false } })
  assert.equal(ocrOff.needsOCR, false)
  assert.equal(ocrOff.hasText, false)
})

test("旧缓存不能复用；来源、手写开关或 OCR 配置变化使缓存失效", () => {
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
runtime.NSData = { dataWithStringEncoding: (value: string) => ({ value, writeToFileAtomically: (path: string) => { files.set(path, value); return true } }),
  dataWithContentsOfFile: (path: string) => files.has(path) ? { base64Encoding: () => Buffer.from(files.get(path)!, "binary").toString("base64") } : null }
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
  onRequest = request => request.complete(request.url.includes("layout_parsing") ? { md_results: "识别后的题目文字" } : response())
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
async function prepare(handwritingUris: string[] = []) {
  const job = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  const input = await bridge("aiGetPreparationQuestion", { jobId: job.id, recordId: "one" })
  await bridge("aiSubmitPreparationImage", { jobId: job.id, recordId: "one", imageDataUri: input.nativeOnly ? "" : "data:image/jpeg;base64,aW1hZ2U=", handwritingDataUris: handwritingUris })
  await until(async () => (await bridge("aiGetQuestionPreparationJob", { jobId: job.id })).status === "done")
  return { job, input }
}
/** 新模型下分析只读准备快照：走真实准备任务循环为当前全部错题生成快照。 */
async function prepareAll() {
  const job = await bridge("aiStartQuestionPreparation", { studySetId: "book" })
  for (let i = 0; i < 500; i++) {
    const state = await bridge("aiGetQuestionPreparationJob", { jobId: job.id })
    const current = state.current
    if (state.status === "done" || state.status === "cancelled") return state
    try {
      if (current?.stage === "waiting-render") {
        await bridge("aiGetPreparationQuestion", { jobId: job.id, recordId: current.recordId })
      } else if (current?.stage === "rendering") {
        // 原生文字直读题不提交截图；图片题使用不同图片，避免命中 OCR 内容缓存导致后续题目不发请求。
        const image = `data:image/jpeg;base64,${Buffer.from(`image-${current.index}`).toString("base64")}`
        await bridge("aiSubmitPreparationImage", { jobId: job.id, recordId: current.recordId, imageDataUri: image })
      } else if (state.status === "waiting-advance" && ["success", "failed"].includes(current.stage)) {
        await bridge("aiAdvanceQuestionPreparation", { jobId: job.id })
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error("准备任务未在测试期限内结束")
}

test("未开启 OCR 时图片题被拒绝，文字题仍可直接分析", async () => {
  const settings = await reset()
  add("one", card('<img src="data:image/png;base64,aW1hZ2U=" />'))
  add("two", card("<p>题干文字</p>"))
  await bridge("aiSaveSettings", { ...settings, mineru: { ...settings.mineru, enabled: false } })
  await prepareAll()
  const job = await finished((await analyze()).id)
  assert.equal(job.status, "done")
  assert.equal(requests.filter(item => item.url.includes("layout_parsing")).length, 0)
  const report = await bridge("aiGetReport", { reportId: job.reportId })
  assert.equal(report.coverage.unavailable, 1)
  assert.match(report.content.limitations.join("\n"), /未开启题目识别/)
  const prompt = requests.filter(item => item.url.includes("llm"))[0].body.messages[1].content
  assert.match(prompt, /题干文字/)
  assert.doesNotMatch(prompt, /Q001/)
})

test("纯文字题未做 OCR 准备也能直接分析，不再被静默计入内容不可用", async () => {
  await reset()
  // 关键差异：不调用 prepareAll()——prepared 快照不存在，题目必须走原生文字路径
  add("one", card("<p>题干文字</p>"))
  const job = await finished((await analyze()).id)
  assert.equal(job.status, "done")
  const prompt = requests.filter(item => item.url.includes("llm"))[0].body.messages[1].content
  assert.match(prompt, /Q001/)
  assert.match(prompt, /题干文字/)
  const report = await bridge("aiGetReport", { reportId: job.reportId })
  assert.equal(report.coverage.unavailable, 0)
  assert.equal(report.coverage.analyzed, 1)
})

test("旧 OCR 缓存被拒绝；手写开启时渲染含手写且以独立图片随题发送", async () => {
  const settings = await reset(); add("one", card(`<p>题干</p>${picture}`)); sketch = { drawing: "hash" }
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, handwriting: true } })
  const { input } = await prepare(["data:image/jpeg;base64,aGFuZHdyaXRpbmc="])
  assert.match(input.questionHtml, /ZHJhd2luZw==/)
  assert.match(input.questionHtml, /mindmap-hash/)
  const snapshot = JSON.parse([...files.entries()].find(([path]) => path.includes("/records/"))![1])
  assert.equal(snapshot.provider, "bigmodel")
  assert.equal(snapshot.handwritingImages?.length, 1)
  assert.equal((await finished((await analyze()).id)).status, "done")
  const sent = requests.filter(item => item.url.includes("llm"))
  assert.match(sent[0].body.messages[1].content[0].text, /识别后的题目文字/)
  assert.match(sent[0].body.messages[1].content[0].text, /附件 Q001-H1：本题手写内容/)
  assert.deepEqual(sent[0].body.messages[1].content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,aGFuZHdyaXRpbmc=" } })
  // 关闭手写内容后，同一题不再附带图片，也不得沿用开启手写时的旧缓存。
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, handwriting: false } })
  assert.equal((await finished((await analyze()).id)).status, "failed")
  assert.equal(requests.filter(item => item.url.includes("llm")).length, 1)
})

test("截图后改原题阻止上传；OCR 返回期间改手写不能保存新快照", async () => {
  const settings = await reset(); add("one", card(picture)); sketch = { drawing: "hash" }
  await bridge("aiSaveSettings", { ...settings, privacy: { ...settings.privacy, handwriting: true } })
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
    await reset(); add(); await prepareAll()
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
  const settings = await reset(); add(); await prepareAll()
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
  // 全部为文字题：原生直读，不发生 OCR 请求；第二题超预算按整题跳过。
  await prepareAll()
  onRequest = request => request.complete(response(["Q001", "Q002", "Q003", "toString"]))
  const job = await finished((await analyze()).id)
  assert.equal(job.status, "done")
  const prompt = requests.filter(item => item.url.includes("llm"))[0].body.messages[1].content
  assert.ok(prompt.length <= 120000)
  assert.doesNotMatch(prompt, /Q002|Q003/)
  const report = await bridge("aiGetReport", { reportId: job.reportId })
  assert.deepEqual(report.evidence, { Q001: "one" })
  assert.deepEqual(report.content.weakPoints[0].evidence, ["Q001"])
  assert.equal(report.coverage.analyzed, 1)
  assert.equal(report.coverage.budgetOmitted, 1)
  assert.equal(report.coverage.unavailable, 1)
})

test("分析请求图片附件走服务实际支持的图像字段，不把 Base64 拼进 prompt 文本", () => {
  const attachments = [{ reference: "Q001-H1", dataUri: "data:image/jpeg;base64,QQ==" }]
  const chat = analysisUserContent("题目文本", attachments, true)
  assert.deepEqual(chat[0], { type: "text", text: "题目文本" })
  assert.deepEqual(chat[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QQ==" } })
  assert.doesNotMatch(chat[0].text, /base64/)
  const responses = analysisUserContent("题目文本", attachments, false)
  assert.deepEqual(responses[0], { type: "input_text", text: "题目文本" })
  assert.deepEqual(responses[1], { type: "input_image", image_url: "data:image/jpeg;base64,QQ==" })
  const textOnly = analysisUserContent("纯文本", [], true)
  assert.deepEqual(textOnly, [{ type: "text", text: "纯文本" }])
})
