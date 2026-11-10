import { escapeHtml } from "../../../src/html-utils"
import { ocrPreview } from './ocrPreview'

const previewCredentials={'ocr-glm':'preview-only-c913'}
let previewOCREngine='glm-ocr'
const DAY = 86400000
const levelCurves = [[1, 3, 7], [2, 5, 10], [14]]
let customCategories = ["计算题", "概念辨析", "需要重做"]
let debugAnswerPreviewMode = "custom"
let debugModeEnabled = false
let reviewAlgorithm = "fixed"
let debugUpdateDownloadsEnabled = false
let debugAutoInstallUpdatesEnabled = false
let pluginEnabled = true
let previewClipper = { mode: false, running: false, started: false, excerptTitle: true, toolLabels: {} }
let sourceLocateMode = "locate"
let previewPersonalSettings = { globalQuestionColors: [], entranceDefaultMode: "practice", boundHandwritingDisplay: "doubleTap", mistakeListDisplay: "always", subcardAnswerDisplay: "window", answerMaskStyle: "dark", answerMaskColor: "#141922", maskImageConfigured: false, autoCollapseComments: false, reviewExpandedCommentCount: 2, reviewCompletionConfetti: true }
let manualTodayIds = []
let previewBindings = [
  { key: "questions::root::main", notebookId: "questions", notebookTitle: "多元微分", sourceRootNodeId: "main", sourceTitle: "考研真题", answerTitle: "多元微分答案 › 标准答案", hasAnswerMindMap: true, selectionMode: "designated", designatedAnswer: "mindmap", questionColors: [1], availableColors: [0, 1, 2, 3] },
  { key: "practice::root::main", notebookId: "practice", notebookTitle: "强化练习", sourceRootNodeId: "main", sourceTitle: "方向导数", answerTitle: "—", hasAnswerMindMap: false, selectionMode: "designated", designatedAnswer: "subcard", questionColors: [2], availableColors: [0, 2, 4] }
]

function endOfTodayTs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}

function dateFromNow(days) {
  return new Date(Date.now() + days * DAY).toISOString()
}

const records = [
  {
    recordId: "questions:q1",
    sourceNoteId: "q1",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "1994数一",
    sourcePathTitles: ["基本概念题", "偏导与连续"],
    categoryPath: ["多元微分", "基本概念题", "偏导与连续"],
    categoryLabel: "多元微分 › 基本概念题 › 偏导与连续",
    categoryKeys: [],
    manualCategories: ["概念辨析", "需要重做"],
    manualCategory: "概念辨析",
    favorite: true,
    level: 0,
    createdAt: dateFromNow(-6),
    updatedAt: dateFromNow(-2),
    lastReviewedAt: dateFromNow(-2),
    nextReviewAt: dateFromNow(-1),
    reviewCount: 1,
    history: [
      { at: dateFromNow(-120), level: 0 }, { at: dateFromNow(-92), level: 1 },
      { at: dateFromNow(-70), level: 0 }, { at: dateFromNow(-55), level: 1 },
      { at: dateFromNow(-42), level: 1 }, { at: dateFromNow(-31), level: 2 },
      { at: dateFromNow(-24), level: 1 }, { at: dateFromNow(-18), level: 2 },
      { at: dateFromNow(-13), level: 1 }, { at: dateFromNow(-9), level: 2 },
      { at: dateFromNow(-6), level: 0 }, { at: dateFromNow(-2), level: 0 }
    ],
    noteAvailable: true
  },
  {
    recordId: "questions:q2",
    sourceNoteId: "q2",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "2002数一 · 条件极值",
    sourcePathTitles: ["极值问题", "条件极值"],
    categoryPath: ["多元微分", "极值问题", "条件极值"],
    categoryLabel: "多元微分 › 极值问题 › 条件极值",
    categoryKeys: [],
    manualCategories: ["计算题", "条件极值"],
    manualCategory: "计算题",
    level: 1,
    createdAt: dateFromNow(-4),
    updatedAt: dateFromNow(-3),
    lastReviewedAt: dateFromNow(-3),
    nextReviewAt: dateFromNow(-0.1),
    reviewCount: 0,
    history: [{ at: dateFromNow(-4), level: 1 }],
    noteAvailable: true
  },
  {
    recordId: "practice:q3",
    sourceNoteId: "q3",
    sourceNotebookId: "practice",
    sourceNotebookTitle: "强化练习",
    sourceTitle: "26版660第239题 · 方向导数",
    sourcePathTitles: ["多元微分", "方向导数"],
    categoryPath: ["强化练习", "多元微分", "方向导数"],
    categoryLabel: "强化练习 › 多元微分 › 方向导数",
    categoryKeys: [],
    level: 1,
    createdAt: dateFromNow(-3),
    updatedAt: dateFromNow(-1),
    lastReviewedAt: dateFromNow(-1),
    nextReviewAt: dateFromNow(5),
    reviewCount: 0,
    history: [{ at: dateFromNow(-3), level: 1 }],
    noteAvailable: true
  },
  {
    recordId: "questions:q4",
    sourceNoteId: "q4",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "2010数一 · 隐函数二阶偏导",
    sourcePathTitles: ["隐函数", "高阶偏导"],
    categoryPath: ["多元微分", "隐函数", "高阶偏导"],
    categoryLabel: "多元微分 › 隐函数 › 高阶偏导",
    categoryKeys: [],
    level: 2,
    createdAt: dateFromNow(-20),
    updatedAt: dateFromNow(-10),
    lastReviewedAt: dateFromNow(-10),
    nextReviewAt: dateFromNow(20),
    reviewCount: 1,
    history: [{ at: dateFromNow(-20), level: 2 }],
    noteAvailable: true
  },
  {
    recordId: "past:q5",
    sourceNoteId: "q5",
    sourceNotebookId: "past",
    sourceNotebookTitle: "真题分类",
    sourceTitle: "2018数一 · 二重积分换元",
    sourcePathTitles: ["重积分", "变量替换"],
    categoryPath: ["真题分类", "重积分", "变量替换"],
    categoryLabel: "真题分类 › 重积分 › 变量替换",
    categoryKeys: [],
    level: 2,
    createdAt: dateFromNow(-80),
    updatedAt: dateFromNow(-18),
    lastReviewedAt: dateFromNow(-18),
    nextReviewAt: dateFromNow(42),
    reviewCount: 2,
    history: [{ at: dateFromNow(-80), level: 2 }, { at: dateFromNow(-18), level: 2 }],
    reviewCompleted: true,
    noteAvailable: true
  }
]

function workbench() {
  const now = Date.now()
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const endToday = startToday + 86400000
  return {
    records,
    dueCount: records.filter(record => record.noteAvailable && !record.reviewCompleted && new Date(record.nextReviewAt).getTime() < endToday).length,
    todayDueCount: records.filter(record => {
      const dueAt = new Date(record.nextReviewAt).getTime()
      return record.noteAvailable && !record.reviewCompleted && dueAt >= startToday && dueAt < endToday
    }).length,
    levelCounts: [0, 1, 2].map(level => records.filter(record => record.level === level).length),
    categories: [],
    migratedFromLegacy: 0,
    reviewCurves: { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] },
    customCategories
  }
}

const questionHtml = `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>1994数一</h2><p>设二元函数 f(x,y) 在点 (x₀,y₀) 处的两个偏导数存在，判断该函数在该点连续的充分性与必要性。</p><div style="margin-top:20px;padding:18px;background:#f5f7fb;border-radius:12px">这里显示 MarginNote 原题卡片的完整摘录、图片、评论与手写内容。</div></body></html>`
const answerHtml = `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>实时答案</h2><p>两个偏导数存在，既不是函数在该点连续的充分条件，也不是必要条件。</p><div style="margin-top:20px;padding:18px;background:#f4f8f5;border-radius:12px">实际插件会从原题脑图当前绑定的答案脑图读取完整答案卡片。</div></body></html>`

function questionHtmlFor(record) {
  const title = escapeHtml(record.sourceTitle)
  const path = escapeHtml(record.sourcePathTitles.join(" › "))
  return `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>${title}</h2><p>本题完整原题卡片内容，所属章节：${path}。</p><div style="margin-top:20px;padding:18px;background:#f5f7fb;border-radius:12px">实际插件会读取该错题在 MarginNote 中的完整摘录、图片、评论与手写内容。</div></body></html>`
}

function detail(recordId) {
  const record = records.find(item => item.recordId === recordId)
  if (!record) throw new Error("错题记录不存在")
  return {
    record,
    questionHtml: questionHtmlFor(record),
    // 首条记录预置两个答案：验证多答案切换控件
    answers: [
      { id: `answer:${record.sourceNoteId}`, title: `${record.sourceTitle} · 标准答案`, path: "答案脑图 › 标准答案", html: answerHtml },
      ...(records[0] === record ? [{ id: `answer:${record.sourceNoteId}:alt`, title: `${record.sourceTitle} · 解法二`, path: "答案脑图 › 解法二", html: answerHtml.replace("实时答案", "解法二") }] : [])
    ],
    answerStatus: "ready"
  }
}

function workbenchPage(offset = 0, transferId = "preview-workbench") {
  const data = workbench()
  const pageSize = 25
  const safeOffset = Math.max(0, Number(offset) || 0)
  const pageRecords = data.records.slice(safeOffset, safeOffset + pageSize)
  const consumed = safeOffset + pageRecords.length
  const recordsComplete = consumed >= data.records.length
  return {
    ...data,
    records: pageRecords,
    transferId,
    totalCount: data.records.length,
    nextOffset: recordsComplete ? undefined : consumed,
    recordsComplete
  }
}

let localCachePreview = [
  { id: "indexes", title: "答案索引", clearable: false, files: 3, bytes: 2500000, documentKnownBytes: 0, documentFiles: 0 },
  { id: "pdf", title: "PDF 预览与导出图片暂存", clearable: true, files: 20, bytes: 175921800, documentKnownBytes: 175000000, documentFiles: 15 },
  { id: "logs", title: "诊断日志", clearable: true, files: 1, bytes: 695800, documentKnownBytes: 0, documentFiles: 0 },
  { id: "templates", title: "模板临时文件", clearable: true, files: 2, bytes: 494500, documentKnownBytes: 0, documentFiles: 0 },
  { id: "exports", title: "导出文件", clearable: true, files: 5, bytes: 10000000, documentKnownBytes: 10000000, documentFiles: 5 },
  { id: "saved", title: "手写与 AI", clearable: false, files: 200, bytes: 25000000, documentKnownBytes: 25000000, documentFiles: 200 },
  { id: "dataBackups", title: "插件数据备份", clearable: false, files: 2, bytes: 1200000, documentKnownBytes: 1200000, documentFiles: 2 },
  { id: "ocrDatabase", title: "OCR 数据库", clearable: false, files: 1, bytes: 4000000, documentKnownBytes: 4000000, documentFiles: 1 },
  { id: "ocrBackups", title: "OCR 数据库备份", clearable: false, files: 2, bytes: 8000000, documentKnownBytes: 8000000, documentFiles: 2 },
  { id: "updates", title: "更新包与恢复备份", clearable: true, files: 30, bytes: 10000000, documentKnownBytes: 0, documentFiles: 0 },
  { id: "other", title: "其他本地文件", clearable: false, files: 2, bytes: 808185, documentKnownBytes: 808185, documentFiles: 2 },
  { id: "recycle", title: "回收站（待手动删除）", clearable: false, files: 0, bytes: 0, documentKnownBytes: 0, documentFiles: 0, recyclePath: "/Documents/CardLink/回收站" }
].map(group => ({ ...group, knownBytes: group.bytes, documentBytes: group.documentKnownBytes, paths: [], scanRoots: ["/Documents/CardLink", "/Caches/CardLink", "/tmp/CardLink"] }))

// Browser-only samples exercise the same accepted-task / progress / result contract.
let previewCacheTask = null
function previewCacheStatus(taskId) {
  const task = previewCacheTask
  if (!task || task.taskId !== taskId) throw new Error("缓存任务已失效")
  const elapsed = Date.now() - task.started, duration = task.operation === "clear" ? 1600 : 800
  if (task.status === "running") {
    task.progress = { phase: task.operation === "scan" || elapsed < 400 ? "scan" : elapsed < 1200 ? "clear" : "verify", directories: Math.min(12, Math.floor(elapsed / 70)), visited: Math.min(263, Math.floor(elapsed / 3)), processed: Math.min(26, Math.floor(elapsed / 50)), total: 26, removed: 0, failed: 0, skipped: 0 }
    if (elapsed >= duration) {
      let removed = 0
      if (task.operation === "clear") {
        removed = localCachePreview.filter(group => task.payload.ids.includes(group.id)).reduce((sum, group) => sum + group.files, 0)
        const bytes = localCachePreview.filter(group => task.payload.ids.includes(group.id)).reduce((sum, group) => sum + group.bytes, 0)
        const recycle = localCachePreview.find(group => group.id === "recycle")
        recycle.files += removed; recycle.bytes += bytes; recycle.knownBytes = recycle.bytes; recycle.documentFiles = recycle.files; recycle.documentKnownBytes = recycle.bytes; recycle.documentBytes = recycle.bytes
        localCachePreview = localCachePreview.map(group => task.payload.ids.includes(group.id) ? { ...group, files: 0, bytes: 0, knownBytes: 0, documentFiles: 0, documentBytes: 0, documentKnownBytes: 0 } : group)
      }
      task.status = "done"
      task.result = { groups: localCachePreview.map(group => ({ ...group })), removed, failed: 0, skipped: 0, failures: [], scanIncomplete: false }
    }
  }
  return { ...task, progress: { ...task.progress } }
}

export async function previewSend(command, payload = null) {
  if (command.startsWith('ocrDb')) return ocrPreview(command,payload,records)
  if (command === "scanLocalCache" || command === "clearLocalCache") {
    if (previewCacheTask?.status === "running") return previewCacheStatus(previewCacheTask.taskId)
    if (command === "clearLocalCache" && payload.ids.some(id => !localCachePreview.some(group => group.id === id && group.id !== "recycle" && group.id !== "ocrDatabase" && (group.clearable || payload.allowRetained === true)))) throw new Error("删除保留文件需要明确确认")
    previewCacheTask = { taskId: `preview-cache-${Date.now()}`, operation: command === "clearLocalCache" ? "clear" : "scan", status: "running", started: Date.now(), payload,
      progress: { phase: "scan", directories: 0, visited: 0, processed: 0, total: 0, removed: 0, failed: 0, skipped: 0 } }
    return { ...previewCacheTask }
  }
  if (command === "localCacheTaskStatus") return previewCacheStatus(payload.taskId)

  if (debugModeEnabled && reviewAlgorithm === "fsrs" && ["saveMistakeReviewCurves", "reviewMistake", "changeMistakeLevel", "reviewMistakes", "changeMistakeLevels", "resumeMistakeReview"].includes(command)) throw new Error("FSRS 模式下固定曲线只读，请在待复习中提交反馈")
  if (command === "setReviewAlgorithm") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    if (!["fixed", "fsrs"].includes(payload?.algorithm)) throw new Error("无效的算法")
    if (payload.algorithm === "fsrs") (await import("./fsrsPreview")).fsrsPreview("initialize", null, records)
    reviewAlgorithm = payload.algorithm
    return { algorithm: reviewAlgorithm }
  }
  if (command.startsWith("fsrs")) {
    if (!debugModeEnabled || reviewAlgorithm !== "fsrs") throw new Error("请先开启调试模式和智能复习")
    if (command === "fsrsContent") return detail(payload.recordId)
    return (await import("./fsrsPreview")).fsrsPreview(command, payload, records)
  }
  if (command === "startFsrsReviewMode") throw new Error("原生复习模式需要在 MarginNote 中使用")
  if (command === "mistakesRevision") return { revision: workbench().revision || "preview" }
  // AI 配置页与总览 AI 面板的预览 mock：形状与原生 publicSettings/报告索引一致。
  if(command==='ocrReadCredential')return {value:previewCredentials[payload.credentialRef]||''}
  if(command==='ocrSetCredential'){previewCredentials[payload.credentialRef]=payload.value||previewCredentials[payload.credentialRef]||'';return {configured:!!previewCredentials[payload.credentialRef]}}
  if(command==='ocrClearCredential'){delete previewCredentials[payload.credentialRef];return {configured:false}}
  if (command === "ocrGetSettings") return {
    ocrEngine: previewOCREngine,
    mineru: { enabled: true, baseUrl: "https://mineru.net", credentialRef: "ocr-mineru", model: "vlm", language: "ch", enableFormula: true, enableTable: true, policy: "auto" },
    glmOcr: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", credentialRef: "ocr-glm", model: "glm-ocr", timeoutMs: 120000 },
    credentials: {
      "ocr-mineru": { configured: !!previewCredentials['ocr-mineru'], persistence: "local", maskedSuffix: (previewCredentials['ocr-mineru']||'').slice(-4) },
      "ocr-glm": { configured: !!previewCredentials['ocr-glm'], persistence: "local", maskedSuffix: (previewCredentials['ocr-glm']||'').slice(-4) }
    }
  }
  if (command === "ocrSaveSettings") {if(payload.ocrEngine)previewOCREngine=payload.ocrEngine;return payload}
  if (command === "ocrListMistakeStudySets") return [{ id: "questions", title: "高等数学题集", mistakeCount: 2 }, { id: "practice", title: "强化练习", mistakeCount: 1 }]
  if (command === "refreshMistakeList") return { refreshed: 0 }
  if (command === "dashboard") return {
    reviewAlgorithm: debugModeEnabled ? reviewAlgorithm : "fixed",
    clipper: previewClipper,
    version: "2.4.0 · 完整界面预览",
    mistakes: workbenchPage(),
    manualTodayIds,
    matching: {
      scopedBinding: true,
      mode: "title",
      matchedGroups: 0,
      pairs: 0,
      regexRules: { questionPattern: "", answerPattern: "" },
      debugModeEnabled,
      debugUpdateDownloadsEnabled,
      debugAnswerPreviewMode,
      debugAutoInstallUpdatesEnabled,
      pluginEnabled,
      sourceLocateMode,
      ...previewPersonalSettings
    },
    answerBindings: previewBindings
  }
  if (command === "bindingSettingsSnapshot") {
    const dashboard = await previewSend("dashboard")
    return { matching: dashboard.matching, answerBindings: previewBindings, clipper: previewClipper }
  }
  if (command === "setClipperTitle") { previewClipper = { ...previewClipper, excerptTitle: payload?.enabled === true }; return previewClipper }
  if (command === "setClipperAnswer") { previewClipper = { ...previewClipper, excerptAnswer: payload?.enabled === true }; return previewClipper }
  if (command === "recordClipperTool") throw new Error("请在 MarginNote 中选择并记录摘录工具")
  if (command === "openClipperMode") throw new Error("请在 MarginNote 中打开文档后使用摘题快捷区")
  if (command === "chooseClipperAnswerPosition") throw new Error("请在 MarginNote 中选择答案位置（目前支持子卡片）")
  if (command === "configureClipperTitleFormat") throw new Error("请在 MarginNote 中设置标题格式：原始标题、统一前缀、母卡标题前缀或母卡内自动题号")
  if (command === "setPersonalSetting") {
    if (payload?.key === "answerMaskImage") previewPersonalSettings.maskImageConfigured = Boolean(payload.value)
    else if (payload?.key === "answerMaskColor") { previewPersonalSettings.answerMaskColor = payload.value; previewPersonalSettings.maskImageConfigured = false }
    else previewPersonalSettings[payload?.key] = payload?.value
    return (await previewSend("dashboard")).matching
  }
  if (command === "chooseReviewCommentCount") return (await previewSend("dashboard")).matching
  if (command === "updateManagedAnswerBinding") {
    previewBindings = previewBindings.map(row => row.key === payload?.key ? { ...row, ...payload?.changes } : row)
    return { updated: true }
  }
  if (command === "deleteManagedAnswerBinding") {
    previewBindings = previewBindings.filter(row => row.key !== payload?.key)
    return { deleted: true }
  }
  if (command === "addGlobalAnswerBindingColor") {
    previewPersonalSettings.globalQuestionColors = [...new Set([...previewPersonalSettings.globalQuestionColors, 3])]
    return { color: 3 }
  }
  if (command === "addManagedAnswerBindingColor") {
    const color = 3
    previewBindings = previewBindings.map(row => row.key === payload?.key ? { ...row, questionColors: [...new Set([...row.questionColors, color])] } : row)
    return { color }
  }
  if (command === "refreshManagedAnswerBinding" || command === "chooseManagedAnswerMindMap") return { preview: true }
  if (command === "mistakes") return workbenchPage()
  if (command === "mistakesPage") return workbenchPage(payload?.offset, String(payload?.transferId || "preview-workbench"))
  if (command === "addManualTodayOverdue") {
    const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const pool = records.filter(item => !item.reviewCompleted && new Date(item.nextReviewAt).getTime() < startToday && !manualTodayIds.includes(item.recordId))
    const added = pool.slice(0, Math.max(0, Math.min(5, Number(payload?.count) || 0))).map(item => item.recordId)
    manualTodayIds = [...manualTodayIds, ...added]
    return { ids: manualTodayIds, addedCount: added.length }
  }
  if (command === "testTelemetryConnectivity") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    return {
      test: true,
      testedAt: new Date().toISOString(),
      results: [
        { key: "测试1", reachable: true, accepted: true, statusCode: 204, durationMs: 12 },
        { key: "测试2", reachable: true, accepted: true, statusCode: 204, durationMs: 30 }
      ]
    }
  }
  if (command === "setDebugMode") {
    debugModeEnabled = payload?.enabled === true
    if (!debugModeEnabled) { debugUpdateDownloadsEnabled = false; debugAutoInstallUpdatesEnabled = false }
    return { enabled: debugModeEnabled, algorithm: debugModeEnabled ? reviewAlgorithm : "fixed" }
  }
  if (command === "chooseAnswerPreviewMode") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugAnswerPreviewMode = debugAnswerPreviewMode === "native" ? "custom" : "native"
    return { debugAnswerPreviewMode }
  }
  if (command === "setDebugUpdateDownloads") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugUpdateDownloadsEnabled = payload?.enabled === true
    return { debugUpdateDownloadsEnabled }
  }
  if (command === "showUpdateStatus") return { preview: true }
  if (command === "setDebugAutoInstallUpdates") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugAutoInstallUpdatesEnabled = payload?.enabled === true
    return { debugAutoInstallUpdatesEnabled }
  }
  if (command === "setPluginEnabled") {
    pluginEnabled = payload?.enabled === true
    return { enabled: pluginEnabled }
  }
  if (command === "mistakeDetail") {
    const value = detail(String(payload?.recordId ?? ""))
    if (payload?.content === "question") return { ...value, answers: [], answerStatus: "deferred" }
    if (payload?.content === "answers") return { ...value, questionHtml: "" }
    return value
  }
  if (command === "mistakeQuestion") {
    const value = detail(String(payload?.recordId ?? ""))
    return { questionHtml: value.questionHtml }
  }
  if (command === "openMistakeHandwriting") {
    throw new Error("浏览器预览无法打开 MarginNote 原生手写板，请在支持场景插件的 MarginNote 中使用")
  }
  if (command === "chooseSourceLocateMode") {
    sourceLocateMode = sourceLocateMode === "focus" ? "locate" : "focus"
    return { mode: sourceLocateMode }
  }
  if (command === "setMistakeFavorite") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    record.favorite = payload?.favorite === true
    return record
  }
  if (command === "migrateLegacyFavorites") {
    const titles = new Set(Array.isArray(payload?.titles) ? payload.titles.map(String) : [])
    let migrated = 0
    let ambiguous = 0
    for (const title of titles) {
      const matches = records.filter(item => item.sourceTitle === title)
      if (matches.length === 1) { matches[0].favorite = true; migrated++ }
      else if (matches.length > 1) ambiguous++
    }
    return { migrated, ambiguous }
  }
  if (command === "reviewMistake") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    manualTodayIds = manualTodayIds.filter(id => id !== record.recordId)
    const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
    const sameLevel = nextLevel === record.level
    record.reviewCount = sameLevel ? record.reviewCount + 1 : 0
    record.level = nextLevel
    record.lastReviewedAt = new Date().toISOString()
    record.updatedAt = record.lastReviewedAt
    record.nextReviewAt = dateFromNow(levelCurves[record.level][Math.min(record.reviewCount, levelCurves[record.level].length - 1)])
    record.reviewCompleted = record.level === 2 && sameLevel && record.reviewCount >= 1
    record.history = [...(record.history || []), { at: record.updatedAt, level: record.level }]
    return record
  }
  if (command === "changeMistakeLevel") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
    if (nextLevel === record.level) return record
    record.level = nextLevel
    record.reviewCount = 0
    record.reviewCompleted = false
    record.updatedAt = new Date().toISOString()
    record.nextReviewAt = dateFromNow(levelCurves[nextLevel][0])
    record.history = [...(record.history || []), { at: record.updatedAt, level: nextLevel }]
    return record
  }
  if (command === "reviewMistakes" || command === "changeMistakeLevels") {
    const ids = new Set((payload?.recordIds || []).map(String))
    const changed = []
    for (const record of records) {
      if (!ids.has(record.recordId)) continue
      const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
      if (nextLevel === record.level) continue
      record.level = nextLevel
      record.lastReviewedAt = new Date().toISOString()
      record.updatedAt = record.lastReviewedAt
      record.nextReviewAt = dateFromNow(levelCurves[record.level][0])
      record.reviewCount = 0
      record.reviewCompleted = false
      changed.push(record)
    }
    return { changed: changed.length, missing: ids.size - changed.length, records: changed }
  }
  if (command === "resumeMistakeReview") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    record.reviewCompleted = false
    record.reviewCount = 0
    record.updatedAt = new Date().toISOString()
    record.nextReviewAt = dateFromNow(levelCurves[record.level][0])
    return record
  }
  if (command === "setMistakeCategory") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (record) {
      const next = Array.isArray(payload?.categories) ? payload.categories.map(String) : [String(payload?.category ?? "")].filter(Boolean)
      record.manualCategories = [...new Set(next)]
      record.manualCategory = record.manualCategories[0]
      customCategories = [...new Set([...customCategories, ...record.manualCategories])]
    }
    return record
  }
  if (command === "deleteMistakeTag") {
    const tag = String(payload?.tag ?? "")
    customCategories = customCategories.filter(item => item !== tag)
    let changed = 0
    for (const record of records) {
      const previous = record.manualCategories || (record.manualCategory ? [record.manualCategory] : [])
      if (!previous.includes(tag)) continue
      record.manualCategories = previous.filter(item => item !== tag)
      record.manualCategory = record.manualCategories[0]
      changed++
    }
    return { tag, changed }
  }
  if (command === "removeMistake") {
    const index = records.findIndex(item => item.recordId === String(payload?.recordId ?? ""))
    if (index >= 0) records.splice(index, 1)
    return { removed: true }
  }
  if (command === "removeMistakes") {
    const ids = new Set((payload?.recordIds || []).map(String))
    const removed = []
    for (let index = records.length - 1; index >= 0; index--) {
      if (!ids.has(records[index].recordId)) continue
      removed.push(...records.splice(index, 1))
    }
    return { changed: removed.length, missing: ids.size - removed.length, records: removed }
  }
  if (command === "saveMistakeReviewCurves") return payload?.curves || workbench().reviewCurves
  if (command === "previewMistakeExport") {
    // 与真机契约一致：recordIds 为严格白名单，空数组 = 零道，绝不回退成全部
    const exportIds = (payload?.recordIds || []).map(String)
    const all = exportIds.flatMap(id => records.find(item => item.recordId === id) || [])
    const chosen = all.slice(0, 3)
    if (!chosen.length) throw new Error("当前预览范围没有可用错题")
    const exportInclude = { handwriting: false, comments: false, ...(payload?.include || {}) }
    const exportExtras = `${exportInclude.handwriting ? '<section aria-label="脑图绑定书写">脑图绑定书写示例</section>' : ''}${exportInclude.comments ? `<details class="card-comment" open><summary>评论</summary><p>卡片子评论示例</p>${exportInclude.handwriting ? '<p>评论书写示例</p>' : ''}</details>` : ''}`
    if (payload?.format === "md") {
      const markdown = [`# MN4 错题导出`, "", ...chosen.flatMap((item, index) => [`## ${index + 1}. ${item.sourceTitle}`, "", `来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}`, "", "### 原题卡片", "", "题目卡片正文", "", "### 实时匹配答案", "", "答案卡片正文", "", "---", ""])]
      if (exportExtras) markdown.push(exportExtras)
      return { preview: true, format: "md", count: all.length, previewCount: chosen.length, truncated: all.length > chosen.length, markdown: markdown.join("\n") }
    }
    const include = { question: true, answer: true, source: true, review: false, ...(payload?.include || {}) }
    const question = (item, index) => `<article class="mistake question-unit"><header><b>${index + 1}.</b><h1>${item.sourceTitle}</h1></header>${include.source ? `<small>来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}</small>` : ""}${include.question ? `<div class="card">${questionHtml}${exportExtras}</div>` : ""}<div class="writing-space"></div></article>`
    const answer = (item, index) => `<article class="mistake answer-unit"><header><b>答案 ${index + 1}</b><h1>${item.sourceTitle}</h1></header><div class="card">${answerHtml}${exportExtras}</div></article>`
    const questions = chosen.map(question)
    const answers = include.answer ? chosen.map(answer) : []
    const perPage = payload?.pageLayout === "one-per-page" ? 1 : payload?.pageLayout === "two-per-page" ? 2 : payload?.pageLayout === "three-per-page" ? 3 : 0
    const flow = (blocks, className) => blocks.length ? `<section class="pdf-flow ${className}">${blocks.map(block => `<div class="pdf-slot">${block}</div>`).join("")}</section>` : ""
    let content
    if (!perPage) {
      const blocks = payload?.answerLayout === "end" ? [...questions, ...answers] : chosen.map((item, index) => `${question(item, index)}${include.answer ? answer(item, index) : ""}`)
      content = flow(blocks, "pdf-compact-flow")
    }
    else {
      const pages = Array.from({ length: Math.ceil(questions.length / perPage) }, (_, page) => {
        const start = page * perPage
        const pageQuestions = questions.slice(start, start + perPage)
        const questionPage = `<section class="pdf-page slots-${perPage}">${pageQuestions.map(block => `<div class="pdf-slot">${block}</div>`).join("")}</section>`
        return payload?.answerLayout === "after-each" ? questionPage + flow(answers.slice(start, start + pageQuestions.length), "pdf-answer-flow") : questionPage
      })
      content = pages.join("") + (payload?.answerLayout === "end" ? flow(answers, "pdf-answer-flow") : "")
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff}body{width:186mm;font:12px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#172033}.pdf-flow .pdf-slot+.pdf-slot{margin-top:1.55em}.pdf-flow{width:186mm}.pdf-answer-flow{padding:2mm 1mm}.pdf-page{width:186mm;min-height:273mm;display:grid}.slots-1{grid-template-rows:1fr}.slots-2{grid-template-rows:repeat(2,minmax(0,1fr))}.slots-3{grid-template-rows:repeat(3,minmax(0,1fr))}.pdf-page .pdf-slot{padding:3mm 1mm}.mistake{padding:3mm 1mm}.mistake header{display:flex;align-items:baseline;gap:8px}.mistake h1{font-size:18px;margin:0}.mistake small{color:#7b8494}.card{margin-top:8px;padding:12px;background:#f4f6f9;border-radius:6px}.writing-space{height:${payload?.pageLayout === "one-per-page" ? "80mm" : payload?.pageLayout === "two-per-page" ? "35mm" : payload?.pageLayout === "three-per-page" ? "16mm" : "0"}}.answer-unit{margin-top:8px}</style></head><body class="layout-${payload?.pageLayout || "compact"}">${content}</body></html>`
    return { preview: true, format: "pdf", count: all.length, previewCount: chosen.length, truncated: all.length > chosen.length, html }
  }
  if (command === "exportMistakes") {
    const exportIds = (payload?.recordIds || []).map(String)
    const chosen = records.filter(item => exportIds.includes(item.recordId))
    if (!chosen.length) throw new Error("当前导出范围没有可用错题")
    const extension = payload?.format === "md" ? "md" : "pdf"
    const filename = `${String(payload?.filename || "MN4错题导出").replace(/\.(md|pdf)$/i, "")}.${extension}`
    const link = document.createElement("a")
    if (extension === "pdf") return { printPanel: true, printCompleted: true, format: "pdf", filename, count: chosen.length }
    else {
      const markdown = [`# MN4 错题导出`, "", ...chosen.flatMap((item, index) => [`## ${index + 1}. ${item.sourceTitle}`, "", `**错题${item.level}级** · ${item.categoryLabel}`, "", `来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}`, "", "### 原题卡片", "", questionHtml, "", "### 实时匹配答案", "", answerHtml, "", "---", ""])]
      link.href = URL.createObjectURL(new Blob([markdown.join("\n")], { type: "text/markdown;charset=utf-8" }))
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    return { saved: true, format: extension, filename, count: chosen.length }
  }
  return { preview: true }
}
