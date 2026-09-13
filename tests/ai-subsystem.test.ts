import { readFileSync } from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"
import { extractAIOutputText, parseAIReport } from "../src/ai-report"
import { mineruDoneResults, mineruFailureMessage, mineruMissingDoneArchive, mineruResultItems, mineruServiceError, mineruStateSummary } from "../src/mineru-response"
import { decodeBase64Utf8 } from "../src/base64"

const handwriting = readFileSync("src/bound-handwriting.ts", "utf8")
const source = readFileSync("src/ai-subsystem.ts", "utf8")
const mineruResponseSource = readFileSync("src/mineru-response.ts", "utf8")
const web = readFileSync("web/src/main.jsx", "utf8")
const core = readFileSync("src/rails-core.ts", "utf8")
const manager = readFileSync("src/mistake-manager.ts", "utf8")
const plugin = readFileSync("src/plugin.ts", "utf8")
const storagePaths = readFileSync("src/storage-paths.ts", "utf8")

test("JSON 文件读取带存在性预检，缺失文件不再触发原生异常闪退", () => {
  // readJSON 仅允许出现在带 isfileExists 预检的 readJSONFile 助手内部：
  // 文件缺失时 data 为 nil，JSONObjectWithData 会抛出 JS 无法捕获的 NSInvalidArgumentException。
  assert.equal((source.match(/readJSON\(/g) || []).length, 1)
  assert.match(source, /if \(!isfileExists\(path\)\) return undefined/)
  assert.match(source, /function reports\(\): any\[\] \{ const value = readJSONFile\(`\$\{reportRoot\(\)\}\/index\.json`\)/)
  assert.match(source, /readJSONFile\(path\)/)
  // JS try/catch 对原生 NSInvalidArgumentException 无效，禁止用它替代存在性预检
  assert.match(source, /该异常穿透 JavaScriptCore/)
})

test("脑图视图未就绪时选择查询走空回退，dashboard 不再整体失败", () => {
  assert.match(plugin, /MN\.notebookController\?\.mindmapview \? NodeNote\.getSelectedNodes\(\) : \[\]/i)
  assert.match(core, /MN\.notebookController\?\.mindmapview \? NodeNote\.getSelectedNodes\(\) : \[\]/i)
})

test("AI 配置页加入共享滚动、触摸与内边距清单", () => {
  const controls = readFileSync("web/src/ui/controls.css", "utf8")
  const shell = readFileSync("web/src/ui/shell.css", "utf8")
  const settings = readFileSync("web/src/ui/settings.css", "utf8")
  assert.match(controls, /\.settingsPage,\s*\.aiSettingsPage,\s*\.exportPage\s*\{[^}]*overflow:\s*auto/)
  assert.match(controls, /\.settingsPage,\s*\.aiSettingsPage,\s*\.exportPage\s*\{[^}]*touch-action:\s*pan-y/)
  assert.match(shell, /html,\s*body\s*\{[^}]*touch-action:\s*pan-x pan-y/)
  assert.doesNotMatch(shell, /html,\s*body\s*\{[^}]*touch-action:\s*none/)
  assert.match(shell, /section\.settingsPage,\s*body > #root > \.shell > main > section\.aiSettingsPage,\s*body > #root > \.shell > main > section\.exportPage/)
  assert.match(settings, /\.aiSettingsPage\s*\{[^}]*grid-auto-rows:\s*max-content;\s*[^}]*align-content:\s*start;/)
})

test("配置页遵循摘要行＋展开编辑规范，密钥只显示掩码尾部", () => {
  assert.match(web, /const \[expandedKey, setExpandedKey\] = useState\(""\)/)
  assert.match(web, /className="aiRow aiRowButton"/)
  assert.match(web, /已配置 \u00b7\u00b7\u00b7\u00b7\$\{state\.maskedSuffix/)
  assert.match(web, /AI_FREQUENCY_LABELS/)
})

test("AI 设置与错题主库存储隔离", () => {
  assert.match(source, /mn4-answer-matcher\.ai\.settings\.v1/)
  assert.match(source, /cardLinkDocumentPath\("ai\/reports"\)/)
  assert.doesNotMatch(source, /mn4-answer-matcher\.mistakes\.v2/)
})

test("科目归一化阻止学习集重复归属", () => {
  assert.match(source, /const claimed = new Set<string>/)
  assert.match(source, /filter\(id => !claimed\.has\(id\)\)/)
})

test("密钥由原生安全输入接收且只向 Web 暴露状态", () => {
  assert.match(source, /UIAlertViewStyle\.SecureTextInput/)
  assert.match(source, /maskedSuffix/)
  assert.match(source, /不具备系统 Keychain 加密/)
})

test("MinerU 使用精准解析批量接口并限制每批 50 项", () => {
  assert.match(source, /api\/v4\/file-urls\/batch/)
  assert.match(source, /i \+= 50/)
  assert.match(source, /model_version: "vlm"/)
})

test("MinerU OCR 显示上传、轮询和下载阶段，预签名上传保持空 Content-Type", () => {
  assert.match(source, /setOCRProgress[\s\S]*job\.detail = detail/)
  assert.match(source, /正在申请[\s\S]*正在上传图片[\s\S]*等待 MinerU 解析[\s\S]*正在下载识别结果/)
  assert.match(source, /headers: \{ "Content-Type": "" \}/)
  assert.match(web, /job\.detail \|\|/)
})

test("MinerU 批量轮询读取官方 extract_result 并在终态停止", () => {
  const done = { code: 0, data: { extract_result: [{ file_name: "question-1.jpg", data_id: "item-1", state: "done", full_zip_url: "https://cdn.example/result.zip" }] } }
  assert.equal(mineruResultItems(done).length, 1)
  assert.deepEqual(mineruDoneResults(done), [{ dataId: "item-1", fileName: "question-1.jpg", zipUrl: "https://cdn.example/result.zip" }])
  assert.equal(mineruFailureMessage(done), undefined)
  assert.equal(mineruMissingDoneArchive(done), false)
  assert.equal(mineruServiceError(done, "查询任务"), undefined)
  assert.match(source, /emptyPolls >= 5/)
  assert.match(source, /连续缺少 data\.extract_result，已停止轮询/)
})

test("MinerU 轮询即时暴露失败原因、业务错误和异常完成响应", () => {
  const failed = { code: 0, data: { extract_result: [{ state: "failed", err_msg: "每日额度已用完" }] } }
  assert.equal(mineruFailureMessage(failed), "每日额度已用完")
  assert.equal(mineruServiceError({ code: -60018, msg: "每日解析任务数量已达上限" }, "查询任务"), "MinerU 查询任务失败：每日解析任务数量已达上限")
  assert.equal(mineruMissingDoneArchive({ data: { extract_result: [{ state: "done" }] } }), true)
  assert.equal(mineruStateSummary({ data: { extract_result: [{ state: "running", extract_progress: { extracted_pages: 1, total_pages: 3 } }] } }), "解析中 1/3页")
  assert.match(source, /MinerU 解析失败：\$\{failure\}/)
  assert.match(source, /已完成解析，但未返回结果下载地址/)
})

test("MinerU Markdown 通过 NSData base64 与纯 JS UTF-8 解码，禁止 NSString 占位对象闪退路径", () => {
  assert.equal(decodeBase64Utf8("TWluZXJV77ya5Y6f6aKYIPCdlb0="), "MinerU：原题 𝕽")
  assert.match(source, /data\.base64Encoding\?\.\(\)/)
  assert.match(source, /decodeBase64Utf8\(String\(encoded\)\)/)
  assert.doesNotMatch(source, /NSString\.alloc\(\)/)
})

test("MinerU 图片复用真机可用的 Latin-1 NSData 桥，不调用缺失的字节静态方法", () => {
  assert.match(source, /function dataFromBase64Source/)
  assert.match(source, /NSData\.dataWithStringEncoding\(decodeBase64Ascii\(base64\), 5\)/)
  assert.match(source, /data: dataFromBase64Source\(uncached\[index\]\)/)
  assert.doesNotMatch(source, /NSData\.dataWithBytesLength/)
  assert.doesNotMatch(source, /decodeBase64Bytes/)
})

test("总览内嵌报告且设置入口位于错题管理", () => {
  assert.match(web, /<AIOverview ready=\{aiReady\} enabled=\{aiEnabled === true\} onOpenSettings=\{onOpenAISettings\} \/>/)
  assert.match(web, /"AI 错题分析（开发中…）", "科目、模型与定期总结"/)
  assert.match(web, /AI 错题总结（开发中…）/)
  for (const title of ["薄弱点", "错误模式", "复习建议", "分析依据"]) assert.match(web, new RegExp(`title="${title}"`))
})

test("每次进入 AI 配置页都先经原生开发提示确认", () => {
  assert.match(web, /MNBridge\.send\("aiConfirmDevelopmentWarning"\)/)
  assert.match(web, /if \(result\?\.confirmed === true\)[\s\S]*?setSettingsPane\("ai"\)/)
  assert.match(source, /AI_DEVELOPMENT_WARNING = "此功能正在开发测试中，暂不保证功能可用性。若启用后插件运行异常，请及时关闭该功能总开关。若有功能建议或问题欢迎反馈。"/)
  assert.match(source, /"返回",\s*\["我就试试"\]/)
  assert.match(source, /UIColor\.colorWithHexString\("#FF3B30"\)/)
})

test("插件使用说明绑定到飞书文档", () => {
  assert.match(plugin, /PLUGIN_GUIDE_URL = "https:\/\/my\.feishu\.cn\/wiki\/VZgUw4yvSizKWFkMEvecctXvn2g"/)
})

test("AI 调度等待错题分页完成、受总开关门控并在分析中逐题让出主线程", () => {
  assert.match(web, /aiReady=\{data\?\.mistakes\?\.recordsComplete === true\}/)
  assert.match(web, /recordsComplete[^]*aiRunDueSchedules/)
  assert.match(web, /if \(next\?\.aiEnabled === true\) MNBridge\.send\("aiRunDueSchedules"\)/)
  assert.match(core, /aiEnabled: aiRuntimeEnabled\(\)/)
  assert.match(source, /await delay\(0\.03\)/)
  assert.match(source, /aiRunDueSchedules[^]*void runDueAIAnalyses\(\)/)
  assert.match(source, /export function aiRuntimeEnabled\(\): boolean \{ return loadAISettings\(\)\.enabled \}/)
})

test("总开关关闭时 AI 运行时命令被原生统一门控，配置命令保持可用", () => {
  const gate = source.match(/if \(!loadAISettings\(\)\.enabled\) throw new Error\("AI 错题分析未开启[\s\S]*?if \(command === "aiDeleteReport"\)/)
  assert.ok(gate, "运行时命令必须位于启用门闸之后")
  const gated = gate[0]
  for (const command of ["aiRunDueSchedules", "aiStartAnalysis", "aiGetJob", "aiPreviewAnalysis", "aiListReports", "aiGetReport", "aiGetCacheStats", "aiOpenEvidence"]) {
    assert.match(gated, new RegExp(`command === "${command}"`))
  }
  const beforeGate = source.slice(0, gate.index ?? 0)
  for (const command of ["aiGetSettings", "aiSaveSettings", "aiListStudySets", "aiListMistakeStudySets", "aiSetCredential", "aiClearCredential", "aiTestProvider", "aiTestMinerU"]) {
    assert.match(beforeGate, new RegExp(`command === "${command}"`))
    assert.doesNotMatch(gated, new RegExp(`command === "${command}"`))
  }
})

test("AI 分析只读提取错题内容，且可跨学习集读取", () => {
  assert.match(manager, /export function createMistakeContentReader\(\)/)
  assert.match(source, /contentReader\.read\(record\.recordId\)/)
  assert.doesNotMatch(source, /mistakeDetailById|saveMistakeState/)
  assert.doesNotMatch(manager.match(/export function createMistakeContentReader\(\): MistakeContentReader \{[\s\S]*?\n\}/)?.[0] || "", /saveMistakeState|syncManualTagsFromSource|upsertMistakeRecord/)
  // MN.db.getNoteById 只覆盖当前学习集；跨学习集读取必须先走当前库、再回退学习集映射
  assert.match(manager, /const current = MN\.db\.getNoteById\(noteId\)/)
  assert.match(manager, /notebookNotes\(MN\.db\.getNotebookById\(notebookId\)\)/)
})

test("运行时不存在的 UIFont 不得进入任何运行时路径", () => {
  // 真机证据：UIFont 全局在 MarginNote JS 运行时不存在（typings 有声明、运行时没有），
  // 引用即抛错——beta.100 曾因答案窗口控件引用它导致答案窗口无法创建。
  for (const file of ["src/window-controls.ts", "src/answer-card-view.ts", "rails-native/WebPanelController.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bUIFont\s*\./)
  }
})

test("原生 Objective-C 类必须走 MarginNote 全局注入，不得从 marginnote 包导入", () => {
  // marginnote 的 d.ts 会列出这些符号，但它的实际 JS exports 不包含它们；
  // 从包导入会被打包成模块属性访问（如 K.NSFileManager），真机结果为 undefined。
  const firstImport = source.match(/^import \{([^}]+)\} from "marginnote"/m)?.[1] || ""
  for (const nativeGlobal of ["NSFileManager", "NSData", "NSJSONSerialization", "NSMutableURLRequest", "NSURLConnection", "NSOperationQueue"]) {
    assert.doesNotMatch(firstImport, new RegExp(`\\b${nativeGlobal}\\b`))
  }
  for (const nativeGlobal of ["NSFileManager", "NSData", "NSJSONSerialization", "NSMutableURLRequest", "NSURLConnection", "NSOperationQueue"]) {
    assert.match(source, new RegExp(`\\b${nativeGlobal}\\b`))
  }
})

test("Foundation 与网络回调 NSNull 均在边界归一化，成功响应不得误判为错误", () => {
  assert.match(source, /export function isNativeNull/)
  assert.match(source, /export function normalizeNativeJSON/)
  assert.match(source, /if \(isNativeNull\(value\)\) return null/)
  assert.match(source, /json = normalizeNativeJSON\(NSJSONSerialization\.JSONObjectWithDataOptions/)
  assert.match(source, /if \(!isNativeNull\(error\)\) return reject\(new Error\(nativeErrorMessage\(error\)\)\)/)
  assert.match(source, /if \(isNativeNull\(response\)\) return reject\(new Error\("网络请求未返回 HTTP 响应"\)\)/)
  assert.match(source, /const responseData = isNativeNull\(data\) \? undefined : data/)
  assert.doesNotMatch(source, /if \(error\) return reject/)
  assert.doesNotMatch(source, /json\?\.error\?\.message \|\| json\?\.msg/)
})

test("DeepSeek 使用 chat completions，分析阶段持续推进进度且空响应可见", () => {
  assert.match(source, /profile\.type === "deepseek"/)
  assert.match(source, /chatCompletions \? "chat\/completions" : "responses"/)
  assert.match(source, /response_format: \{ type: "json_object" \}/)
  assert.match(source, /REPORT_FORMAT_INSTRUCTION/)
  assert.match(source, /extractAIOutputText\(result\.json\)/)
  assert.match(source, /parseAIReport\(result\.text\)/)
  assert.match(source, /async function awaitAnalysisResult/)
  assert.match(source, /job\.progress = Math\.min\(82/)
  assert.match(source, /返回成功，但响应中没有文本内容/)
  assert.match(web, /setStatus\(`正在测试 \$\{profile\.name\}…`\)/)
  assert.match(web, /result\?\.connected \? `\$\{profile\.name\} 连接成功 · \$\{result\.model\}`/)
})

test("报告解析兼容代码围栏、嵌套包装与中文字段", () => {
  const report = parseAIReport(`说明文字\n\`\`\`json
  {"报告":{"总结":"主要薄弱点已定位","优势":["基础概念"],"薄弱点":[{"标题":"变换性质","严重程度":"高","原因":"混淆符号","建议":"对照练习","证据":["Q001"]}],"错误模式":[{"标题":"符号错误","描述":"正负号混淆","引用":["Q001"]}],"复习建议":[{"优先级":"高","标题":"专项练习","行动":"每天五题","证据":["Q001"]}],"局限":["样本较少"]}}
  \`\`\``)
  assert.equal(report.summary, "主要薄弱点已定位")
  assert.equal(report.weakPoints[0]?.suggestion, "对照练习")
  assert.equal(report.errorPatterns[0]?.detail, "正负号混淆")
  assert.deepEqual(report.reviewAdvice[0]?.evidence, ["Q001"])
})

test("模型正文提取兼容 Responses、Chat Completions 数组与结构化结果", () => {
  assert.equal(extractAIOutputText({ output: [{ content: [{ type: "output_text", text: "{\"summary\":\"A\"}" }] }] }), '{"summary":"A"}')
  assert.equal(extractAIOutputText({ choices: [{ message: { content: [{ type: "text", text: "{\"summary\":\"B\"}" }] } }] }), '{"summary":"B"}')
  assert.equal(extractAIOutputText({ choices: [{ message: { parsed: { summary: "C" } } }] }), '{"summary":"C"}')
})

test("报告缺少 summary 时返回实际字段，避免笼统的有效报告错误", () => {
  assert.throws(() => parseAIReport('{"总结内容错误字段":"x"}'), /缺少 summary 文本（实际字段：总结内容错误字段）/)
})

test("批量提取失败原因聚合可见，不再静默吞错", () => {
  assert.match(source, /failureReasons\.set\(reason, \(failureReasons\.get\(reason\) \|\| 0\) \+ 1\)/)
  assert.match(source, /错题内容均无法读取\$\{reasonSummary \? `（\$\{reasonSummary\}）` : ""\}/)
  assert.match(source, /内容不可用 \$\{unavailable\} 道（\$\{reasonSummary\}）/)
})

test("分析题干统一经 analysisQuestionText 取值，纯文字题不依赖 OCR 准备", () => {
  // 此前直接取 prepared.questionText，未准备的纯文字题抛 TypeError 被计入“内容不可用”整题丢弃
  assert.match(source, /const question = analysisQuestionText\(input, prepared\)/)
  assert.match(source, /题目：\$\{question\}/)
  assert.doesNotMatch(source, /题目：\$\{prepared!\.questionText\}/)
})

test("题目准备把整张卡片送 OCR，并将文本独立落盘", () => {
  assert.match(web, /import html2canvas from "html2canvas"/)
  assert.match(web, /html2canvas\(doc\.body/)
  assert.match(web, /aiSubmitPreparationImage/)
  assert.match(web, /当前上传的题目卡片/)
  assert.match(web, /单题进度/)
  assert.match(web, /总进度/)
  assert.match(web, /OCR 返回文本/)
  assert.match(source, /cardLinkDocumentPath\("ai\/content"\)/)
  assert.match(source, /contentFingerprint: sha256Hex\(imageDataUri\)/)
  assert.match(source, /questionText: ocrText/)
  assert.match(source, /provider: "mineru"/)
})

test("OCR 每题保存一个文本快照和同名整卡图片，并可在缓存页逐题对比", () => {
  assert.match(source, /preparedQuestionImagePath\(recordId\)/)
  assert.match(source, /imageData\.writeToFileAtomically\(imagePath, true\)/)
  assert.match(source, /includedMindMapHandwriting:/)
  assert.match(source, /command === "aiListPreparedQuestions"/)
  assert.match(source, /command === "aiGetPreparedQuestion"/)
  assert.match(web, /function OCRResultBrowser/)
  assert.match(web, /发送给 OCR 的原题卡片/)
  assert.match(web, /OCR 文本渲染/)
  assert.match(web, /renderMarkdownPreview\(detail\.questionText\)/)
})

test("持久文件统一进入 CardLink 目录并保留旧目录迁移", () => {
  assert.match(storagePaths, /const CURRENT_DIRECTORY = "CardLink"/)
  assert.match(storagePaths, /const LEGACY_DIRECTORY = "MNAnswerMatcher"/)
  assert.match(storagePaths, /copyItemAtPathToPath/)
  assert.match(storagePaths, /manager\.removeItemAtPath\(source\)/)
  for (const file of ["src/ai-subsystem.ts", "src/mistake-export.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /MNAnswerMatcher\//)
  }
  assert.match(readFileSync("src/mistake-store.ts", "utf8"), /cardLinkDocumentPath\("backups"\)/)
  assert.match(readFileSync("src/index-store.ts", "utf8"), /cardLinkCachePath\("indexes"\)/)
})

test("题目准备可选择智谱 GLM-OCR 并读取 Markdown 结果", () => {
  assert.match(source, /type OCREngine = "mineru" \| "glm-ocr"/)
  assert.match(source, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/)
  assert.match(source, /\/layout_parsing/)
  assert.match(source, /json: \{ model: "glm-ocr", file: base64, return_crop_images: false, need_layout_visualization: false \}/)
  assert.match(source, /result\.json\?\.md_results/)
  assert.match(source, /estimatedBytes > 10 \* 1024 \* 1024/)
  assert.match(source, /return engine === "glm-ocr"[\s\S]*glmOCR[\s\S]*mineruOCR/)
  assert.match(source, /ocrEngine: settings\.ocrEngine/)
  assert.match(source, /const engine: OCREngine = job\.ocrEngine/)
  assert.match(source, /settings\.glmOcr\.credentialRef/)
  assert.match(web, /<option value="glm-ocr">GLM-OCR（智谱）<\/option>/)
  assert.match(web, /本次 API Key/)
  assert.match(web, /官方限制单图不超过 10 MB/)
})

test("题目准备可读取并渲染卡片绑定的脑图手写", () => {
  assert.match(source, /handwriting: boolean/)
  assert.match(source, /handwriting: false/)
  assert.match(handwriting, /getSketchNoteForMindMapFocusNoteId/)
  assert.match(handwriting, /sketchMediaHashes\(sketch\)/)
  assert.match(handwriting, /db\.getMediaByHash\(hash\)\?\.base64Encoding/)
  assert.match(handwriting, /class="drawing bound-mindmap-handwriting-item"/)
  assert.match(handwriting, /data-drawing-id="mindmap-\$\{asset\.hash\}"/)
  assert.match(source, /boundHandwritingStatus/)
  assert.match(handwriting, /const drawings = assets\.filter\(asset => asset\.kind === "drawing"\)/)
  assert.match(web, /includeHandwriting=\{settings\.privacy\.handwriting\}/)
  assert.match(web, /当前 MarginNote 版本不支持读取脑图绑定手写/)
})

test("手写内容可作为独立图片附件发给分析模型", () => {
  assert.match(source, /handwritingImages\?: \{ file: string; bytes: number \}\[\]/)
  assert.match(source, /readImageFileDataUri\(preparedQuestionImageRoot\(\), entry\.file/)
  assert.match(source, /MAX_ANALYSIS_IMAGES/)
  assert.match(source, /analysisUserContent\(prompt, attachments, chatCompletions\)/)
  assert.match(source, /附件 \$\{ref\}-H1\$\{attached\.length > 1 \? `–H\$\{attached\.length\}` : ""\}：本题手写内容/)
  assert.match(source, /未附带手写内容图片/)
  assert.match(web, /bound-mindmap-handwriting/)
  assert.match(web, /handwritingDataUris/)
  assert.match(web, /手写不进入 OCR/)
})

test("OCR 学习集候选只包含实际有错题的学习集", () => {
  assert.match(source, /command === "aiListMistakeStudySets"/)
  assert.match(source, /const counts = new Map<string, number>\(\)/)
  assert.match(source, /counts\.get\(String\(item\.topicId\)\)[^\n]*> 0/)
  assert.match(source, /mistakeCount: counts\.get\(String\(item\.topicId\)\)/)
  assert.match(source, /if \(!records\.length\) throw new Error\("所选学习集没有错题，无需 OCR"\)/)
  assert.match(web, /MNBridge\.send\("aiListMistakeStudySets"\)/)
  assert.match(web, /QuestionPreparationWorkspace studySets=\{mistakeStudySets\}/)
  assert.match(web, /选择含错题的学习集/)
  assert.match(web, /当前没有包含错题的学习集，无需 OCR/)
})



test("题目准备任务逐题统计成功失败并允许单题失败后继续", () => {
  for (const command of ["aiStartQuestionPreparation", "aiGetQuestionPreparationJob", "aiGetPreparationQuestion", "aiSubmitPreparationImage", "aiFailPreparationQuestion", "aiAdvanceQuestionPreparation", "aiCancelQuestionPreparation"]) {
    assert.match(source, new RegExp(`command === "${command}"`))
    assert.match(web, new RegExp(command))
  }
  assert.match(source, /job\.completed \+= 1/)
  assert.match(source, /job\[stage\] \+= 1/)
  assert.match(web, /题目总数[\s\S]*成功[\s\S]*失败/)
})

test("AI 分析并发抑制与任务清理", () => {
  assert.match(source, /if \(hasActiveJob\(subject\.id\)\) throw new Error\("该科目已有分析任务正在进行/)
  assert.match(source, /if \(hasActiveJob\(subject\.id\)\) continue/)
  assert.match(source, /pruneFinishedJobs\(\)/)
})

test("MinerU 结果按 data_id 回对且缓存键为内容 SHA-256 指纹", () => {
  assert.match(source, /uriByDataId\.get\(dataId\)/)
  assert.match(source, /uriByFileName\.get\(fileName\)/)
  assert.match(source, /sha256Hex\(uri\)/)
  assert.match(source, /sha256Hex\(source\)/)
  assert.match(source, /contentFingerprint: sha256Hex\(source\)/)
  assert.match(mineruResponseSource, /extract_result \?\? payload\?\.data\?\.file_results \?\? payload\?\.data\?\.results/)
  assert.doesNotMatch(source, /nestedZipUrls|simpleHash/)
})



test("总览 AI 模块在关闭态只显示状态与前往配置", () => {
  assert.match(web, /AI 分析未开启/)
  assert.match(web, /前往配置/)
  assert.match(web, /onOpenAISettings=\{openAISettings\}/)
})

test("分页横幅仅在续传进行中显示，配置页缓存组仅开启后加载", () => {
  assert.match(web, /recordsComplete === false && streamLoading/)
  assert.match(web, /setStreamLoading\(false\)/)
  assert.match(web, /if \(next\.enabled\) loadStorage\(\)/)
  assert.match(web, /savedState\.enabled\) loadStorage\(\)/)
})

test("调试开关与插件开关共用即时回显数据流，不再依赖整页重载", () => {
  assert.match(web, /command === "setDebugMode" && result/)
  assert.match(web, /debugModeEnabled: result\.enabled === true/)
})

test("AI 页面异常不会导致整个插件界面闪退", () => {
  assert.match(web, /class AIErrorBoundary extends React\.Component/)
  assert.match(web, /normalizeAISettingsView/)
  assert.match(web, /错题加载完成后可用/)
})
